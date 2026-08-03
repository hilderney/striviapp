const fs = require('fs/promises');
const path = require('path');
const { ExtractionError } = require('../errors');
const { buildOutputBaseName } = require('../utils/paths');
const { createPdfParserAdapter } = require('../adapters/pdfParserAdapter');

async function extractText(pdfPath, outputDir, options = {}) {
  const {
    overwrite = false,
    parserAdapter = createPdfParserAdapter(),
    fsImpl = fs,
  } = options;

  const absolutePdfPath = path.resolve(pdfPath);
  const absoluteOutputDir = path.resolve(outputDir);
  const inputFile = path.basename(absolutePdfPath);
  const outputFile = path.join(
    absoluteOutputDir,
    `${buildOutputBaseName(inputFile, 'pdf')}.txt`,
  );

  await fsImpl.mkdir(absoluteOutputDir, { recursive: true });

  if (!overwrite) {
    try {
      await fsImpl.access(outputFile);
      throw new ExtractionError(`Output file already exists: ${outputFile}`);
    } catch (error) {
      if (error instanceof ExtractionError) {
        throw error;
      }
      if (error.code !== 'ENOENT') {
        throw new ExtractionError(`Failed to check output file: ${outputFile}`, error);
      }
    }
  }

  let buffer;
  try {
    buffer = await fsImpl.readFile(absolutePdfPath);
  } catch (error) {
    throw new ExtractionError(`Failed to read PDF: ${absolutePdfPath}`, error);
  }

  let parsed;
  try {
    parsed = await parserAdapter.parse(buffer);
  } catch (error) {
    throw new ExtractionError(`Invalid or corrupted PDF: ${inputFile}`, error);
  }

  const text = parsed.text || '';
  await fsImpl.writeFile(outputFile, text, 'utf8');

  return {
    inputFile,
    outputFile: path.resolve(outputFile),
    pageCount: parsed.pageCount,
    charCount: text.length,
    text,
    extractedAt: new Date().toISOString(),
  };
}

async function extractBatch(pdfPaths, outputDir, options = {}) {
  const results = [];
  const errors = [];

  for (const pdfPath of pdfPaths) {
    try {
      const result = await extractText(pdfPath, outputDir, options);
      results.push(result);
    } catch (error) {
      errors.push({
        inputFile: path.basename(pdfPath),
        path: path.resolve(pdfPath),
        error,
      });
    }
  }

  return { results, errors };
}

module.exports = {
  extractText,
  extractBatch,
};
