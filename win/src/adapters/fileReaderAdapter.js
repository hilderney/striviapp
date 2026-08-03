const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { FileReaderError, ValidationError } = require('../errors');
const { isPathInside } = require('../utils/paths');

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.csv', '.xlsx']);

function getExtension(fileName) {
  return path.extname(fileName).toLowerCase();
}

async function readTxt(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readCsv(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content.replace(/\r\n/g, '\n');
}

async function readXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return '';
  }

  const lines = [];
  sheet.eachRow((row) => {
    const cells = row.values.slice(1).map((value) => {
      if (value == null) {
        return '';
      }
      return String(value);
    });
    lines.push(cells.join('\t'));
  });

  return lines.join('\n');
}

async function readFileContent(sourceFile, outputDir) {
  const extension = getExtension(sourceFile);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ValidationError(`Unsupported file extension: ${extension}`);
  }

  if (!isPathInside(outputDir, sourceFile)) {
    throw new FileReaderError('Invalid file path');
  }

  const filePath = path.join(path.resolve(outputDir), sourceFile);

  try {
    let content;
    if (extension === '.txt') {
      content = await readTxt(filePath);
    } else if (extension === '.csv') {
      content = await readCsv(filePath);
    } else {
      content = await readXlsx(filePath);
    }

    return {
      content,
      sourceFile,
      sourceType: extension.slice(1),
      filePath,
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof FileReaderError) {
      throw error;
    }
    if (error.code === 'ENOENT') {
      throw new FileReaderError(`File not found: ${sourceFile}`);
    }
    throw new FileReaderError(`Failed to read file: ${sourceFile}`, error);
  }
}

function createFileReaderAdapter() {
  return { readFileContent };
}

module.exports = {
  readFileContent,
  createFileReaderAdapter,
  SUPPORTED_EXTENSIONS,
};
