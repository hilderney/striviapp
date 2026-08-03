const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ValidationError } = require('../errors');
const { sanitizeBaseName } = require('../utils/paths');
const { isPdfFile } = require('./fsBrowser');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const INPUT_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls']);

function getInputFileType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.pdf') {
    return 'pdf';
  }
  if (['.xlsx', '.xls', '.csv', '.tsv', '.txt'].includes(extension)) {
    return 'spreadsheet';
  }
  return null;
}

function isAllowedInputFile(name) {
  return INPUT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function resolveStagedFileName(name) {
  const extension = path.extname(name).toLowerCase();
  const base = sanitizeBaseName(name);
  return `${base}${extension}`;
}

async function stageInputFiles(files, stagingRoot = './staging') {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError('At least one file is required');
  }

  const sessionId = crypto.randomUUID();
  const inputDir = path.resolve(stagingRoot, sessionId);
  await fs.mkdir(inputDir, { recursive: true });

  const saved = [];
  let totalBytes = 0;
  let pdfCount = 0;
  let spreadsheetCount = 0;

  for (const file of files) {
    if (!file?.name || !file?.data) {
      throw new ValidationError('Each file must have name and data');
    }

    if (!isAllowedInputFile(file.name)) {
      throw new ValidationError(
        `Unsupported file type (allowed: .pdf, .xlsx, .xls): ${file.name}`,
      );
    }

    const buffer = Buffer.from(file.data, 'base64');
    if (buffer.length > MAX_FILE_BYTES) {
      throw new ValidationError(`File too large (max 50MB): ${file.name}`);
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ValidationError('Total upload size exceeds 200MB');
    }

    const safeName = resolveStagedFileName(file.name);
    const targetPath = path.join(inputDir, safeName);
    await fs.writeFile(targetPath, buffer);

    const type = getInputFileType(safeName);
    if (type === 'pdf') {
      pdfCount += 1;
    } else if (type === 'spreadsheet') {
      spreadsheetCount += 1;
    }

    saved.push({
      name: safeName,
      path: targetPath,
      sizeBytes: buffer.length,
      type,
    });
  }

  return {
    inputDir,
    sessionId,
    pdfCount,
    spreadsheetCount,
    fileCount: saved.length,
    files: saved,
  };
}

async function stagePdfFiles(files, stagingRoot = './staging') {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError('At least one PDF file is required');
  }

  for (const file of files) {
    if (!isPdfFile(file?.name || '')) {
      throw new ValidationError(`Only PDF files are allowed: ${file?.name || 'unknown'}`);
    }
  }

  const staged = await stageInputFiles(files, stagingRoot);
  return {
    inputDir: staged.inputDir,
    sessionId: staged.sessionId,
    pdfCount: staged.pdfCount,
    files: staged.files,
  };
}

module.exports = {
  stageInputFiles,
  stagePdfFiles,
  getInputFileType,
  isAllowedInputFile,
  resolveStagedFileName,
  INPUT_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
};
