const path = require('path');
const { getInputFileType } = require('./stagingUpload');
const { importSpreadsheet } = require('./spreadsheetImporter');
const { buildOutputBaseName } = require('../utils/paths');

async function processPdfFile(filePath, outputDir, phase1Api, options = {}) {
  const batch = await phase1Api.extractBatch([filePath], outputDir, {
    overwrite: options.overwrite !== false,
  });

  const formats = options.formats || ['xlsx'];
  const exports = { csv: [], xlsx: [], pdf: [] };
  const sourceFile = path.basename(filePath);

  for (const result of batch.results) {
    if (formats.includes('csv')) {
      exports.csv.push(
        await phase1Api.exportCsv([result], outputDir, {
          ...options.exportOptions,
          fileName: `${buildOutputBaseName(sourceFile, 'csv')}.csv`,
        }),
      );
    }
    if (formats.includes('xlsx')) {
      exports.xlsx.push(
        await phase1Api.exportXlsx([result], outputDir, {
          ...options.exportOptions,
          fileName: `${buildOutputBaseName(sourceFile, 'xlsx')}.xlsx`,
        }),
      );
    }
    if (formats.includes('pdf')) {
      exports.pdf.push(
        await phase1Api.exportPdf([result], outputDir, {
          ...options.exportOptions,
          fileName: `${buildOutputBaseName(sourceFile, 'pdf')}.pdf`,
        }),
      );
    }
  }

  return {
    type: 'pdf',
    sourceFile,
    extracted: batch.results.length,
    failed: batch.errors.length,
    exports,
    errors: batch.errors,
  };
}

async function processSpreadsheetFile(fileName, inputDir, outputDir, options = {}) {
  const result = await importSpreadsheet(fileName, {
    inputDir,
    outputDir,
    logsDir: options.logsDir,
    formats: options.formats || ['csv', 'xlsx'],
    appendFormatSuffix: true,
    overwrite: options.overwrite !== false,
    baseUrl: options.baseUrl || null,
  });

  return {
    type: 'spreadsheet',
    sourceFile: fileName,
    rowCount: result.rowCount,
    metadata: result.metadata,
    exports: result.exports,
  };
}

async function processInputFiles(inputDir, fileNames, options = {}) {
  const { outputDir, phase1Api, logsDir, baseUrl, overwrite = true } = options;

  if (!phase1Api) {
    throw new Error('phase1Api is required');
  }

  const results = [];
  const errors = [];

  for (const fileName of fileNames) {
    const filePath = path.join(path.resolve(inputDir), fileName);
    const type = getInputFileType(fileName);

    try {
      if (type === 'pdf') {
        results.push(
          await processPdfFile(filePath, outputDir, phase1Api, {
            overwrite,
            exportOptions: options.exportOptions,
            formats: options.formats,
          }),
        );
      } else if (type === 'spreadsheet') {
        results.push(
          await processSpreadsheetFile(fileName, inputDir, outputDir, {
            logsDir,
            baseUrl,
            overwrite,
            formats: options.formats,
          }),
        );
      } else {
        errors.push({ sourceFile: fileName, error: `Unsupported file type: ${fileName}` });
      }
    } catch (error) {
      errors.push({ sourceFile: fileName, error: error.message });
    }
  }

  return {
    processed: results.length,
    failed: errors.length,
    results,
    errors,
  };
}

module.exports = {
  processInputFiles,
  processPdfFile,
  processSpreadsheetFile,
};
