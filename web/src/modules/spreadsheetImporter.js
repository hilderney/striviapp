const fs = require('fs/promises');
const path = require('path');
const { ExportError } = require('../errors');
const { createSpreadsheetReaderAdapter } = require('../adapters/spreadsheetReaderAdapter');
const { createTableParserAdapter } = require('../adapters/tableParserAdapter');
const { createCsvWriterAdapter } = require('../adapters/csvWriterAdapter');
const { createExcelWriterAdapter } = require('../adapters/excelWriterAdapter');
const { createPdfWriterAdapter } = require('../adapters/pdfWriterAdapter');
const { deriveSpreadsheetMetadata } = require('./spreadsheetMetadataParser');
const { buildUnimedSpreadsheet } = require('./unimedSpreadsheetLayout');
const { createLogger } = require('./logger');
const { buildOutputBaseName } = require('../utils/paths');

const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.tsv', '.txt']);

async function listSpreadsheets(inputDir, options = {}) {
  const { recursive = false, readerAdapter = createSpreadsheetReaderAdapter() } = options;
  const absoluteDir = path.resolve(inputDir);

  let entries;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        const nested = await listSpreadsheets(entryPath, options);
        files.push(...nested);
      }
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SPREADSHEET_EXTENSIONS.has(extension)) {
      continue;
    }

    const stats = await fs.stat(entryPath);
    let detectedFormat = extension.slice(1);
    try {
      const preview = await readerAdapter.read(entryPath);
      detectedFormat = preview.detectedFormat || detectedFormat;
    } catch {
      detectedFormat = `unknown-${extension.slice(1)}`;
    }

    files.push({
      name: entry.name,
      path: entryPath,
      sizeBytes: stats.size,
      detectedFormat,
    });
  }

  return files.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

function resolveInputPath(sourceFile, inputDir) {
  if (path.isAbsolute(sourceFile)) {
    return sourceFile;
  }
  return path.join(path.resolve(inputDir || './input'), sourceFile);
}

function buildOutputBaseNameFromSource(sourceFile) {
  return buildOutputBaseName(path.basename(sourceFile), 'sheet');
}

async function assertCanWrite(filePath, overwrite) {
  try {
    await fs.access(filePath);
    if (!overwrite) {
      throw new ExportError(`Output file already exists: ${filePath}`);
    }
  } catch (error) {
    if (error instanceof ExportError) {
      throw error;
    }
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function importSpreadsheet(sourceFile, options = {}) {
  const {
    inputDir = process.env.INPUT_DIR || './input',
    outputDir = process.env.OUTPUT_DIR || './output',
    formats = ['csv', 'xlsx'],
    overwrite = true,
    logsDir = './logs',
    logger = createLogger('spreadsheet-importer', { logsDir }),
    readerAdapter = createSpreadsheetReaderAdapter(),
    tableParserAdapter = createTableParserAdapter('unimed-planilha'),
    csvWriterAdapter = createCsvWriterAdapter(),
    excelWriterAdapter = createExcelWriterAdapter(),
    pdfWriterAdapter = createPdfWriterAdapter(),
    baseUrl = null,
    appendFormatSuffix = false,
  } = options;

  const inputPath = resolveInputPath(sourceFile, inputDir);
  logger.info('Reading spreadsheet', { sourceFile, inputPath });

  const spreadsheet = await readerAdapter.read(inputPath, { baseDir: inputDir });
  const parsed = tableParserAdapter.parseSpreadsheet(spreadsheet);
  const metadata = deriveSpreadsheetMetadata(spreadsheet.rows);
  const sheet = buildUnimedSpreadsheet({ rows: parsed.rows, metadata });

  logger.info('Spreadsheet parsed', {
    sourceFile,
    rowCount: sheet.dataRowCount,
    prestador: metadata.prestador,
  });

  const outputBaseName = buildOutputBaseNameFromSource(sourceFile);
  const absoluteOutputDir = path.resolve(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  const exports = { csv: null, xlsx: null, pdf: null };

  if (formats.includes('csv')) {
    const csvFileName = appendFormatSuffix
      ? `${buildOutputBaseName(path.basename(sourceFile), 'csv')}.csv`
      : `${outputBaseName}.csv`;
    const csvPath = path.join(absoluteOutputDir, csvFileName);
    await assertCanWrite(csvPath, overwrite);
    await csvWriterAdapter.writeSheet(csvPath, sheet.sheetRows);
    exports.csv = {
      filePath: csvPath,
      rowCount: sheet.dataRowCount,
      url: baseUrl ? `${baseUrl}/open/${encodeURIComponent(csvFileName)}` : null,
    };
    logger.info('CSV exported', exports.csv);
  }

  const wantsExcel = formats.some((format) => ['xlsx', 'xls', 'excel'].includes(format));
  if (wantsExcel) {
    const xlsxFileName = appendFormatSuffix
      ? `${buildOutputBaseName(path.basename(sourceFile), 'xlsx')}.xlsx`
      : `${outputBaseName}.xlsx`;
    const xlsxPath = path.join(absoluteOutputDir, xlsxFileName);
    await assertCanWrite(xlsxPath, overwrite);
    await excelWriterAdapter.writeSheet(xlsxPath, sheet.sheetRows);
    exports.xlsx = {
      filePath: xlsxPath,
      rowCount: sheet.dataRowCount,
      url: baseUrl ? `${baseUrl}/open/${encodeURIComponent(xlsxFileName)}` : null,
    };
    logger.info('Excel exported', exports.xlsx);
  }

  if (formats.includes('pdf')) {
    const pdfFileName = appendFormatSuffix
      ? `${buildOutputBaseName(path.basename(sourceFile), 'pdf')}.pdf`
      : `${outputBaseName}.pdf`;
    const pdfPath = path.join(absoluteOutputDir, pdfFileName);
    await assertCanWrite(pdfPath, overwrite);
    await pdfWriterAdapter.writeSheet(pdfPath, sheet.sheetRows);
    exports.pdf = {
      filePath: pdfPath,
      rowCount: sheet.dataRowCount,
      url: baseUrl ? `${baseUrl}/open/${encodeURIComponent(pdfFileName)}` : null,
    };
    logger.info('PDF exported', exports.pdf);
  }

  const result = {
    sourceFile: path.basename(sourceFile),
    rowCount: sheet.dataRowCount,
    metadata,
    exports,
    logFile: logger.logFilePath,
  };

  logger.info('Spreadsheet import completed', {
    sourceFile: result.sourceFile,
    rowCount: result.rowCount,
  });

  return result;
}

module.exports = {
  importSpreadsheet,
  listSpreadsheets,
  resolveInputPath,
  buildOutputBaseName: buildOutputBaseNameFromSource,
  SPREADSHEET_EXTENSIONS,
};
