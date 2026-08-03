const path = require('path');
const { getInputFileType } = require('./stagingUpload');
const { importSpreadsheet } = require('./spreadsheetImporter');

async function processPdfFile(filePath, outputDir, phase1Api, options = {}) {
  const batch = await phase1Api.extractBatch([filePath], outputDir, {
    overwrite: options.overwrite !== false,
  });

  const exports = { csv: [], xlsx: [] };

  for (const result of batch.results) {
    exports.csv.push(await phase1Api.exportCsv([result], outputDir, options.exportOptions));
    exports.xlsx.push(await phase1Api.exportXlsx([result], outputDir, options.exportOptions));
  }

  return {
    type: 'pdf',
    sourceFile: path.basename(filePath),
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
          await processPdfFile(filePath, outputDir, phase1Api, { overwrite, exportOptions: options.exportOptions }),
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
