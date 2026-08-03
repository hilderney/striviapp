const path = require('path');
const { ExportError } = require('../errors');
const { createCsvWriterAdapter } = require('../adapters/csvWriterAdapter');
const { createExcelWriterAdapter } = require('../adapters/excelWriterAdapter');
const {
  createTableParserAdapter,
  TABLE_EXPORT_HEADERS,
} = require('../adapters/tableParserAdapter');
const { buildOutputBaseName } = require('../utils/paths');
const { parseUnimedMetadata } = require('./unimedMetadataParser');
const { buildUnimedSpreadsheet } = require('./unimedSpreadsheetLayout');

const LEGACY_HEADERS = [
  { id: 'filename', title: 'filename' },
  { id: 'source_pdf', title: 'source_pdf' },
  { id: 'extracted_at', title: 'extracted_at' },
  { id: 'content', title: 'content' },
];

function assertNonEmptyResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new ExportError('Export requires at least one extraction result');
  }
}

function buildExportFileNameFromPdf(inputFile, extension) {
  return `${buildOutputBaseName(inputFile, 'pdf')}.${extension}`;
}

function resolveExportFileName(results, extension, fileName) {
  if (fileName) {
    return fileName;
  }

  if (results.length === 1) {
    return buildExportFileNameFromPdf(results[0].inputFile, extension);
  }

  const date = new Date().toISOString().slice(0, 10);
  return `export_${date}.${extension}`;
}

function resolveExportFormat(options = {}) {
  return options.format === 'legacy' ? 'legacy' : 'unimed-report';
}

/**
 * Parses each extraction result and yields its table rows. A row is "valid"
 * when it has both `guia` and `codigo_procedimento`; invalid rows are only
 * yielded when `tableOnly` is false (raw/fallback mode).
 */
function* iterateParsedRows(results, tableParserAdapter, tableOnly) {
  for (const result of results) {
    const parsed = tableParserAdapter.parse(result.text || '');
    for (const row of parsed.rows) {
      const isValid = Boolean(row.guia && row.codigo_procedimento);
      if (!isValid && tableOnly) {
        continue;
      }
      yield { result, row, isValid };
    }
  }
}

function toExportRow(result, row, isValid) {
  if (isValid) {
    return {
      source_pdf: result.inputFile,
      guia: row.guia,
      dt_emis: row.dt_emis,
      beneficiario: row.beneficiario,
      id_beneficiario: row.id_beneficiario,
      pl: row.pl,
      medico: row.medico,
      requisicao: row.requisicao,
      codigo_procedimento: row.codigo_procedimento,
      procedimento: row.procedimento,
      qt: row.qt,
    };
  }

  return {
    source_pdf: result.inputFile,
    guia: row.guia || '',
    dt_emis: row.dt_emis || '',
    beneficiario: row.beneficiario || row.content || '',
    id_beneficiario: row.id_beneficiario || '',
    pl: row.pl || '',
    medico: row.medico || '',
    requisicao: row.requisicao || '',
    codigo_procedimento: row.codigo_procedimento || '',
    procedimento: row.procedimento || '',
    qt: row.qt || '',
  };
}

function toLegacyRows(results) {
  return results.map((result) => ({
    filename: path.basename(result.outputFile),
    source_pdf: result.inputFile,
    extracted_at: result.extractedAt || new Date().toISOString(),
    content: result.text || '',
  }));
}

function toTableRows(results, options = {}) {
  const {
    tableParserAdapter = createTableParserAdapter('auto'),
    tableOnly = true,
  } = options;

  const rows = [];
  for (const { result, row, isValid } of iterateParsedRows(results, tableParserAdapter, tableOnly)) {
    rows.push(toExportRow(result, row, isValid));
  }
  return rows;
}

function collectTableRowsFromResults(results, options = {}) {
  const {
    tableParserAdapter = createTableParserAdapter('auto'),
    tableOnly = true,
  } = options;

  const rows = [];
  for (const { row } of iterateParsedRows(results, tableParserAdapter, tableOnly)) {
    rows.push(row);
  }
  return rows;
}

function resolveSourceText(results) {
  for (const result of results) {
    if (parseUnimedMetadata(result.text || '').prestador) {
      return result.text || '';
    }
  }
  return results.length > 0 ? results[0].text || '' : '';
}

function resolveUnimedSheet(results, options = {}) {
  const rows = collectTableRowsFromResults(results, options);
  return buildUnimedSpreadsheet({ text: resolveSourceText(results), rows });
}

function resolveExportRows(results, options = {}) {
  const {
    tableOnly = true,
    fallbackToRaw = true,
    tableParserAdapter = createTableParserAdapter('auto'),
  } = options;

  const tableRows = toTableRows(results, { tableOnly, tableParserAdapter });

  if (tableRows.length > 0) {
    return { rows: tableRows, headers: TABLE_EXPORT_HEADERS, mode: 'table' };
  }

  if (tableOnly && !fallbackToRaw) {
    throw new ExportError('No table rows found in extraction results');
  }

  return { rows: toLegacyRows(results), headers: LEGACY_HEADERS, mode: 'raw' };
}

/**
 * Shared export routine for CSV and XLSX. When the resolved rows form a Unimed
 * table it writes the rich `unimed-report` layout; otherwise it writes a flat
 * sheet with the resolved headers.
 */
async function writeExport(results, outputDir, options, { extension, writer, errorLabel }) {
  assertNonEmptyResults(results);

  const resolvedFileName = resolveExportFileName(results, extension, options.fileName);
  const filePath = path.resolve(path.join(path.resolve(outputDir), resolvedFileName));
  const resolved = resolveExportRows(results, options);
  const sourcePdf = results.length === 1 ? results[0].inputFile : null;

  try {
    if (resolved.mode === 'table' && resolveExportFormat(options) === 'unimed-report') {
      const sheet = resolveUnimedSheet(results, options);
      await writer.writeSheet(filePath, sheet.sheetRows, options);
      return { filePath, rowCount: sheet.dataRowCount, sourcePdf, format: 'unimed-report' };
    }

    await writer.write(filePath, resolved.rows, resolved.headers);
  } catch (error) {
    throw new ExportError(`${errorLabel}: ${filePath}`, error);
  }

  return {
    filePath,
    rowCount: resolved.rows.length,
    sourcePdf,
    format: resolved.mode === 'table' ? 'legacy' : resolved.mode,
  };
}

function exportCsv(results, outputDir, options = {}) {
  return writeExport(results, outputDir, options, {
    extension: 'csv',
    writer: options.csvWriterAdapter || createCsvWriterAdapter(),
    errorLabel: 'Failed to write CSV',
  });
}

function exportXlsx(results, outputDir, options = {}) {
  return writeExport(results, outputDir, options, {
    extension: 'xlsx',
    writer: options.excelWriterAdapter || createExcelWriterAdapter(),
    errorLabel: 'Failed to write Excel',
  });
}

module.exports = {
  exportCsv,
  exportXlsx,
  resolveExportRows,
  resolveUnimedSheet,
  resolveExportFormat,
  toTableRows,
  buildExportFileNameFromPdf,
  resolveExportFileName,
  EXPORT_HEADERS: TABLE_EXPORT_HEADERS,
  CSV_HEADERS: TABLE_EXPORT_HEADERS,
  LEGACY_HEADERS,
};
