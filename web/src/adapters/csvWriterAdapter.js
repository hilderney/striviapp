const fs = require('fs/promises');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

class CsvWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('CsvWriterAdapter.write() must be implemented');
  }
}

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatSheetLine(cells, separator = '\t') {
  if (!cells || cells.length === 0) {
    return '';
  }
  if (cells.length === 1) {
    return cells[0];
  }
  return cells.map(escapeCsvField).join(separator);
}

class CsvWriterLibAdapter extends CsvWriterAdapter {
  async write(filePath, rows, headers) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const writer = createObjectCsvWriter({
      path: filePath,
      header: headers,
      alwaysQuote: true,
    });
    await writer.writeRecords(rows);
  }

  async writeSheet(filePath, sheetRows, options = {}) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const separator = options.separator || '\t';
    const lines = sheetRows.map((row) => formatSheetLine(row.cells, separator));
    await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  }
}

function createCsvWriterAdapter(type = 'csv-writer') {
  switch (type) {
    case 'csv-writer':
      return new CsvWriterLibAdapter();
    default:
      throw new Error(`Unknown CSV writer adapter: ${type}`);
  }
}

module.exports = {
  CsvWriterAdapter,
  CsvWriterLibAdapter,
  createCsvWriterAdapter,
};
