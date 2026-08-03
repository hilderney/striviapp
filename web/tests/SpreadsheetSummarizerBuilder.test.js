const fs = require('fs/promises');
const path = require('path');
const { SpreadsheetSummarizerBuilder } = require('../src/pipeline/SpreadsheetSummarizerBuilder');
const { createTempDir } = require('./helpers/fixtures');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');

describe('SpreadsheetSummarizerBuilder', () => {
  let inputDir;
  let outputDir;
  let logsDir;

  beforeEach(async () => {
    inputDir = await createTempDir('spreadsheet-builder-input-');
    outputDir = await createTempDir('spreadsheet-builder-output-');
    logsDir = await createTempDir('spreadsheet-builder-logs-');
    await fs.copyFile(FIXTURE_PATH, path.join(inputDir, 'demo.xls'));
  });

  afterEach(async () => {
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('[F3-49] build() sem fromSpreadsheet deve lançar erro ao run()', async () => {
    const pipeline = SpreadsheetSummarizerBuilder.create()
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withoutServer()
      .build();

    await expect(pipeline.run()).rejects.toThrow('Spreadsheet source is required');
    await pipeline.close();
  });

  test('[F3-50] fromSpreadsheet + outputTo + run() deve retornar summary com exports', async () => {
    const pipeline = SpreadsheetSummarizerBuilder.create()
      .fromSpreadsheet('demo.xls')
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withoutServer()
      .build();

    pipeline.config.inputDir = inputDir;
    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.imported).toBe(1);
    expect(summary.imports[0].exports.csv).toBeTruthy();
    expect(summary.imports[0].exports.xlsx).toBeTruthy();
  });

  test('[F3-51] fromDirectory deve processar múltiplas planilhas em batch', async () => {
    await fs.copyFile(FIXTURE_PATH, path.join(inputDir, 'demo2.xls'));

    const pipeline = SpreadsheetSummarizerBuilder.create()
      .fromDirectory(inputDir)
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withoutServer()
      .build();

    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.imported).toBe(2);
  });

  test('[F3-52] withoutServer() não deve iniciar servidor HTTP', async () => {
    const pipeline = SpreadsheetSummarizerBuilder.create()
      .fromSpreadsheet('demo.xls')
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withoutServer()
      .build();

    pipeline.config.inputDir = inputDir;
    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.serverUrl).toBeNull();
  });

  test('[F3-53] serveLinks() deve expor serverUrl no summary', async () => {
    const pipeline = SpreadsheetSummarizerBuilder.create()
      .fromSpreadsheet('demo.xls')
      .outputTo(outputDir)
      .withLogs(logsDir)
      .serveLinks(0)
      .build();

    pipeline.config.inputDir = inputDir;
    const summary = await pipeline.run();
    await pipeline.close();

    expect(summary.serverUrl).toMatch(/^http:\/\//);
  });

  test('[F3-54] close() deve encerrar servidor e logger sem leak', async () => {
    const pipeline = SpreadsheetSummarizerBuilder.create()
      .fromSpreadsheet('demo.xls')
      .outputTo(outputDir)
      .withLogs(logsDir)
      .serveLinks(0)
      .build();

    pipeline.config.inputDir = inputDir;
    await pipeline.run();
    await expect(pipeline.close()).resolves.toBeUndefined();
  });
});
