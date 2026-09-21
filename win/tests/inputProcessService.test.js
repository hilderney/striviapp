const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { processInputFiles, processPdfFile } = require('../src/modules/inputProcessService');
const { stageInputFiles } = require('../src/modules/stagingUpload');
const phase1Api = require('../src/api');
const { createValidPdfBuffer, createTempDir } = require('./helpers/fixtures');

const FIXTURE_TSV = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');

async function createSampleXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('demo');
  const content = await fs.readFile(FIXTURE_TSV, 'utf8');
  const lines = content.trim().split('\n');
  for (const line of lines) {
    sheet.addRow(line.split('\t'));
  }
  await workbook.xlsx.writeFile(filePath);
}

describe('inputProcessService', () => {
  let stagingRoot;
  let outputDir;

  beforeEach(async () => {
    stagingRoot = await createTempDir('input-process-staging-');
    outputDir = await createTempDir('input-process-output-');
  });

  afterEach(async () => {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('processa PDF e planilha no mesmo lote', async () => {
    const pdfBuffer = await createValidPdfBuffer('input process');
    const staged = await stageInputFiles(
      [{ name: 'doc.pdf', data: pdfBuffer.toString('base64') }],
      stagingRoot,
    );

    const xlsxPath = path.join(staged.inputDir, 'demo.xlsx');
    await createSampleXlsx(xlsxPath);

    const summary = await processInputFiles(
      staged.inputDir,
      ['doc.pdf', 'demo.xlsx'],
      { outputDir, phase1Api, logsDir: outputDir },
    );

    expect(summary.processed).toBe(2);
    expect(summary.results.some((item) => item.type === 'pdf')).toBe(true);
    expect(summary.results.some((item) => item.type === 'spreadsheet')).toBe(true);
  });

  test('gera somente os formatos selecionados com sufixo do tipo de saída', async () => {
    const selectedFormatApi = {
      extractBatch: jest.fn().mockResolvedValue({
        results: [{ inputFile: 'doc.pdf', text: 'conteúdo' }],
        errors: [],
      }),
      exportCsv: jest.fn(),
      exportXlsx: jest.fn().mockResolvedValue({
        filePath: path.join(outputDir, 'doc_xlsx.xlsx'),
      }),
    };

    const result = await processPdfFile(path.join(stagingRoot, 'doc.pdf'), outputDir, selectedFormatApi, {
      formats: ['xlsx'],
    });

    expect(result.exports.csv).toEqual([]);
    expect(result.exports.xlsx).toHaveLength(1);
    expect(path.basename(result.exports.xlsx[0].filePath)).toBe('doc_xlsx.xlsx');
    expect(selectedFormatApi.exportCsv).not.toHaveBeenCalled();
    expect(selectedFormatApi.exportXlsx).toHaveBeenCalledWith(
      [expect.objectContaining({ inputFile: 'doc.pdf' })],
      outputDir,
      expect.objectContaining({ fileName: 'doc_xlsx.xlsx' }),
    );
  });

  test('planilha usa sufixo csv e não gera xlsx quando somente CSV foi selecionado', async () => {
    const staged = await stageInputFiles(
      [{ name: 'placeholder.pdf', data: (await createValidPdfBuffer('stage')).toString('base64') }],
      stagingRoot,
    );
    const xlsxPath = path.join(staged.inputDir, 'demo.xlsx');
    await createSampleXlsx(xlsxPath);

    const summary = await processInputFiles(staged.inputDir, ['demo.xlsx'], {
      outputDir,
      phase1Api,
      logsDir: outputDir,
      formats: ['csv'],
    });

    const result = summary.results[0];
    expect(path.basename(result.exports.csv.filePath)).toBe('demo_csv.csv');
    expect(result.exports.xlsx).toBeNull();
    await expect(fs.access(result.exports.csv.filePath)).resolves.toBeUndefined();
  });
});
