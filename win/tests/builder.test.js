const fs = require('fs/promises');
const path = require('path');
const { PdfSummarizerBuilder } = require('../src/pipeline/PdfSummarizerBuilder');
const { createTempDir, writeMinimalPdf } = require('./helpers/fixtures');

describe('PdfSummarizerBuilder', () => {
  let inputDir;
  let outputDir;
  let logsDir;

  beforeEach(async () => {
    inputDir = await createTempDir('builder-input-');
    outputDir = await createTempDir('builder-output-');
    logsDir = await createTempDir('builder-logs-');
    await writeMinimalPdf(inputDir, 'doc.pdf');
  });

  afterEach(async () => {
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('executa pipeline completo com API fluente', async () => {
    const pipeline = PdfSummarizerBuilder.create()
      .fromDirectory(inputDir)
      .outputTo(outputDir)
      .withLogs(logsDir)
      .exportFormats(['csv', 'xlsx'])
      .withoutServer()
      .build();

    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.scanned).toBe(1);
    expect(summary.extracted).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.exports.csv).toHaveLength(1);
    expect(summary.exports.xlsx).toHaveLength(1);
    expect(path.basename(summary.exports.csv[0].filePath)).toBe('doc_pdf.csv');
    expect(path.basename(summary.exports.xlsx[0].filePath)).toBe('doc_pdf.xlsx');
    await expect(fs.access(path.join(outputDir, 'doc_pdf.txt'))).resolves.toBeUndefined();
    await expect(fs.access(summary.logFile)).resolves.toBeUndefined();
  });
});
