const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, PageSizes } = require('pdf-lib');
const { importSpreadsheet } = require('../src/modules/spreadsheetImporter');
const { ExportError } = require('../src/errors');
const { createTempDir } = require('./helpers/fixtures');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');

describe('spreadsheetImporter', () => {
  let inputDir;
  let outputDir;
  let logsDir;

  beforeEach(async () => {
    inputDir = await createTempDir('spreadsheet-import-input-');
    outputDir = await createTempDir('spreadsheet-import-output-');
    logsDir = await createTempDir('spreadsheet-import-logs-');
    await fs.copyFile(FIXTURE_PATH, path.join(inputDir, 'unimed-demonstrativo.xls'));
  });

  afterEach(async () => {
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  async function importFixture(formats = ['csv', 'xlsx']) {
    return importSpreadsheet('unimed-demonstrativo.xls', {
      inputDir,
      outputDir,
      logsDir,
      formats,
      overwrite: true,
    });
  }

  test('[F3-29] deve importar fixture TSV e gerar .csv no layout unimed-report', async () => {
    const result = await importFixture(['csv']);
    expect(result.exports.csv.filePath).toMatch(/unimed-demonstrativo_sheet\.csv$/);

    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('Requisição');
    expect(content).toContain('TOTAL GERAL');
  });

  test('[F3-30] deve importar fixture TSV e gerar .xlsx no layout unimed-report', async () => {
    const result = await importFixture(['xlsx']);
    expect(result.exports.xlsx.filePath).toMatch(/unimed-demonstrativo_sheet\.xlsx$/);

  });

  test('deve importar fixture TSV e gerar PDF válido quando selecionado', async () => {
    const result = await importFixture(['pdf']);
    expect(result.exports.csv).toBeNull();
    expect(result.exports.xlsx).toBeNull();
    expect(result.exports.pdf.filePath).toMatch(/unimed-demonstrativo_sheet\.pdf$/);

    const bytes = await fs.readFile(result.exports.pdf.filePath);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    const [firstPage] = document.getPages();
    expect(firstPage.getWidth()).toBeCloseTo(PageSizes.A4[0], 1);
    expect(firstPage.getHeight()).toBeCloseTo(PageSizes.A4[1], 1);
  });

  test('[F3-31] linha 1 do CSV deve conter prestador derivado', async () => {
    const result = await importFixture(['csv']);
    const lines = (await fs.readFile(result.exports.csv.filePath, 'utf8')).split('\n');
    expect(lines[0]).toContain('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
  });

  test('[F3-32] linha 2 do CSV deve conter paymentLine derivada', async () => {
    const result = await importFixture(['csv']);
    const lines = (await fs.readFile(result.exports.csv.filePath, 'utf8')).split('\n');
    expect(lines[1]).toContain('UNIMED - 1º PGTO PROGRAMADO PARA');
  });

  test('[F3-33] linha 3 do CSV deve conter cabeçalho com 11 colunas', async () => {
    const result = await importFixture(['csv']);
    const lines = (await fs.readFile(result.exports.csv.filePath, 'utf8')).split('\n');
    expect(lines[2].split('\t')).toHaveLength(11);
  });

  test('[F3-34] coluna Vl Bruto deve conter valor real (ex.: R$ 45,54), não placeholder', async () => {
    const result = await importFixture(['csv']);
    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('R$ 45,54');
    expect(content).not.toMatch(/\tR\$ 0,00\tR\$ 0,00/);
  });

  test('[F3-35] coluna Vl Pago deve conter valor real (ex.: R$ 45,54), não R$ 0,00', async () => {
    const result = await importFixture(['csv']);
    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('R$ 45,54');
    expect(content).not.toContain('"R$ 0,00"\t"R$ 0,00"');
  });

  test('[F3-36] deve incluir TOTAL - {Executante} após cada grupo', async () => {
    const result = await importFixture(['csv']);
    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('TOTAL - BOTO');
    expect(content).toContain('TOTAL - CORUJA');
  });

  test('[F3-37] deve incluir TOTAL GERAL após todos os dados', async () => {
    const result = await importFixture(['csv']);
    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('TOTAL GERAL');
  });

  test('[F3-38] deve incluir bloco RESUMO GERAL com VR.SESSÕES agrupados por valor', async () => {
    const result = await importFixture(['csv']);
    const content = await fs.readFile(result.exports.csv.filePath, 'utf8');
    expect(content).toContain('RESUMO GERAL');
    expect(content).toContain('VR.SESSÕES');
    expect(content).toContain('R$ 40,42');
    expect(content).toContain('R$ 45,54');
  });

  test('[F3-39] deve ordenar linhas por Executante → Beneficiário', async () => {
    const result = await importFixture(['csv']);
    const lines = (await fs.readFile(result.exports.csv.filePath, 'utf8')).split('\n');
    const dataLines = lines.slice(3).filter((line) => line.startsWith('604'));
    expect(dataLines[0]).toContain('ARIRANHA');
    expect(dataLines.some((line) => line.includes('CORUJA'))).toBe(true);
  });

  test('[F3-40] deve usar nome de saída derivado do arquivo de entrada (sanitizeBaseName)', async () => {
    const result = await importFixture(['csv']);
    expect(path.basename(result.exports.csv.filePath)).toBe('unimed-demonstrativo_sheet.csv');
  });

  test('[F3-41] deve respeitar overwrite: false e lançar ExportError se arquivo existe', async () => {
    await importFixture(['csv']);
    await expect(
      importSpreadsheet('unimed-demonstrativo.xls', {
        inputDir,
        outputDir,
        logsDir,
        formats: ['csv'],
        overwrite: false,
      }),
    ).rejects.toThrow(ExportError);
  });

  test('[F3-42] deve registrar log de cada etapa via createLogger', async () => {
    const result = await importFixture(['csv']);
    expect(result.logFile).toMatch(/\.log$/);
    const logContent = await fs.readFile(result.logFile, 'utf8');
    expect(logContent).toContain('Reading spreadsheet');
    expect(logContent).toContain('Spreadsheet import completed');
  });
});
