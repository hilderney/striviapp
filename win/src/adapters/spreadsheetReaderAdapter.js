const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const iconv = require('iconv-lite');
const { SpreadsheetError, ValidationError, FileReaderError } = require('../errors');
const { isPathInside } = require('../utils/paths');

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.tsv', '.txt']);

const REQUIRED_HEADER_KEYS = new Set([
  'requisicao',
  'protocolo',
  'guia',
  'beneficiario',
  'atendimento',
  'executante',
  'vl_bruto',
  'vl_pago',
  'qt_item',
  'evento',
]);

function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function normalizeHeader(header) {
  return String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

function detectDelimiter(line) {
  const counts = [
    ['\t', (line.match(/\t/g) || []).length],
    [';', (line.match(/;/g) || []).length],
    [',', (line.match(/,/g) || []).length],
  ];
  counts.sort((left, right) => right[1] - left[1]);
  return counts[0][1] > 0 ? counts[0][0] : '\t';
}

function splitDelimitedLine(line, delimiter) {
  return line.split(delimiter).map((cell) => cell.trim());
}

function decodeBuffer(buffer, forcedEncoding) {
  if (forcedEncoding && forcedEncoding !== 'auto') {
    return iconv.decode(buffer, forcedEncoding);
  }

  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }

  return iconv.decode(buffer, 'win1252');
}

function isRowEmpty(values) {
  return values.every((value) => String(value || '').trim() === '');
}

function buildRowsFromMatrix(headers, matrixRows) {
  return matrixRows.map((cells) => {
    const row = {};
    for (let index = 0; index < headers.length; index += 1) {
      row[headers[index]] = cells[index] ?? '';
    }
    return row;
  });
}

function validateHeaders(headers) {
  const missing = [...REQUIRED_HEADER_KEYS].filter((key) => !headers.includes(key));
  if (missing.length > 0) {
    throw new SpreadsheetError(`Missing required columns: ${missing.join(', ')}`, {
      code: 'MISSING_COLUMNS',
    });
  }
}

function parseDelimitedContent(content, delimiter) {
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => !isRowEmpty(splitDelimitedLine(line, delimiter || detectDelimiter(line))));

  if (lines.length === 0) {
    throw new SpreadsheetError('Spreadsheet has no readable header row', {
      code: 'MISSING_COLUMNS',
    });
  }

  const resolvedDelimiter = delimiter || detectDelimiter(lines[0]);
  const rawHeaders = splitDelimitedLine(lines[0], resolvedDelimiter);
  const headers = rawHeaders.map(normalizeHeader);
  validateHeaders(headers);

  const matrixRows = lines.slice(1).map((line) => splitDelimitedLine(line, resolvedDelimiter));
  const rows = buildRowsFromMatrix(headers, matrixRows);

  return {
    headers,
    rows,
    encoding: 'auto',
    delimiter: resolvedDelimiter,
  };
}

async function readDelimitedFile(filePath, options = {}) {
  const buffer = await fs.readFile(filePath);
  const content = decodeBuffer(buffer, options.encoding || process.env.SPREADSHEET_ENCODING);
  const delimiter = options.delimiter;
  return parseDelimitedContent(content, delimiter);
}

async function readXlsxFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new SpreadsheetError('Spreadsheet workbook has no worksheets', {
      code: 'UNSUPPORTED_FORMAT',
    });
  }

  const matrix = [];
  sheet.eachRow((row) => {
    const cells = row.values.slice(1).map((value) => {
      if (value == null) {
        return '';
      }
      return String(value);
    });
    matrix.push(cells);
  });

  const nonEmpty = matrix.filter((cells) => !isRowEmpty(cells));
  if (nonEmpty.length === 0) {
    throw new SpreadsheetError('Spreadsheet has no readable header row', {
      code: 'MISSING_COLUMNS',
    });
  }

  const headers = nonEmpty[0].map(normalizeHeader);
  validateHeaders(headers);
  const rows = buildRowsFromMatrix(headers, nonEmpty.slice(1));

  return {
    headers,
    rows,
    encoding: 'utf8',
    delimiter: null,
  };
}

function isZipSpreadsheet(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function resolveReaderType(filePath, buffer) {
  const extension = getExtension(filePath);
  if (extension === '.xlsx' || isZipSpreadsheet(buffer)) {
    return 'xlsx';
  }
  return 'delimited';
}

function assertSupportedExtension(filePath) {
  const extension = getExtension(filePath);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ValidationError(`Unsupported file extension: ${extension}`);
  }
}

async function readSpreadsheet(filePath, options = {}) {
  const { baseDir } = options;
  let absolutePath;

  if (baseDir && !path.isAbsolute(filePath)) {
    if (!isPathInside(baseDir, filePath)) {
      throw new FileReaderError('Invalid file path');
    }
    absolutePath = path.join(path.resolve(baseDir), filePath);
  } else {
    absolutePath = path.resolve(filePath);
  }

  assertSupportedExtension(absolutePath);

  let buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SpreadsheetError(`Spreadsheet not found: ${absolutePath}`, {
        code: 'NOT_FOUND',
        cause: error,
      });
    }
    throw new SpreadsheetError(`Failed to read spreadsheet: ${absolutePath}`, {
      code: 'READ_ERROR',
      cause: error,
    });
  }

  const readerType = resolveReaderType(absolutePath, buffer);
  const parsed =
    readerType === 'xlsx'
      ? await readXlsxFile(absolutePath)
      : parseDelimitedContent(decodeBuffer(buffer, options.encoding || process.env.SPREADSHEET_ENCODING));

  return {
    ...parsed,
    filePath: absolutePath,
    detectedFormat: readerType === 'xlsx' ? 'xlsx' : `delimited-${parsed.delimiter === '\t' ? 'tsv' : 'csv'}`,
  };
}

function createSpreadsheetReaderAdapter(type = 'auto') {
  return {
    read(filePath, options = {}) {
      if (type !== 'auto') {
        if (type === 'exceljs') {
          return readXlsxFile(path.resolve(filePath));
        }
        if (type === 'delimited') {
          return readDelimitedFile(filePath, options);
        }
        throw new Error(`Unknown spreadsheet reader: ${type}`);
      }
      return readSpreadsheet(filePath, options);
    },
  };
}

module.exports = {
  readSpreadsheet,
  createSpreadsheetReaderAdapter,
  normalizeHeader,
  detectDelimiter,
  parseDelimitedContent,
  SUPPORTED_EXTENSIONS,
  REQUIRED_HEADER_KEYS,
};
