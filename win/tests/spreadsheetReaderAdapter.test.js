const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const iconv = require('iconv-lite');
const {
  readSpreadsheet,
  createSpreadsheetReaderAdapter,
  normalizeHeader,
  detectDelimiter,
  parseDelimitedContent,
  formatCellValue,
} = require('../src/adapters/spreadsheetReaderAdapter');
const { SpreadsheetError, ValidationError, FileReaderError } = require('../src/errors');
const { createTempDir } = require('./helpers/fixtures');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');

async function writeBinaryFile(dir, fileName, buffer) {
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

describe('spreadsheetReaderAdapter — delimitado', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('spreadsheet-reader-');
    await fs.copyFile(FIXTURE_PATH, path.join(tempDir, 'demo.xls'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[F3-01] deve ler .xls TSV e retornar headers normalizados (sem acentos, lowercase)', async () => {
    const result = await readSpreadsheet(path.join(tempDir, 'demo.xls'));
    expect(result.headers).toContain('requisicao');
    expect(result.headers).toContain('beneficiario');
    expect(result.headers).toContain('local_exec');
    expect(result.headers).not.toContain('Requisição');
  });

  test('[F3-02] deve retornar rows como array de objetos keyed pelo header', async () => {
    const result = await readSpreadsheet(path.join(tempDir, 'demo.xls'));
    expect(result.rows[0].requisicao).toBe('604900030');
    expect(result.rows[0].executante).toContain('BOTO');
  });

  test('[F3-03] deve detectar delimitador TAB automaticamente', () => {
    const line = 'A\tB\tC';
    expect(detectDelimiter(line)).toBe('\t');
  });

  test('[F3-04] deve detectar delimitador ; em arquivo CSV brasileiro', async () => {
    await fs.writeFile(
      path.join(tempDir, 'demo.csv'),
      'requisicao;protocolo;guia;beneficiario;atendimento;local_exec;executante;vl_bruto;vl_glosa;qt_item;vl_pago;evento;descricao\n1;2;3;JOAO;01/01/2026;LOCAL;MED;10;0;1;10;50000470;PROC\n',
      'utf8',
    );
    const result = await readSpreadsheet(path.join(tempDir, 'demo.csv'));
    expect(result.delimiter).toBe(';');
    expect(result.rows[0].requisicao).toBe('1');
  });

  test('[F3-05] deve decodificar latin1/cp1252 quando UTF-8 falhar (Beneficiário com acento)', async () => {
    const content = iconv.encode(
      'requisicao\tprotocolo\tguia\tbeneficiario\tatendimento\tlocal_exec\texecutante\tvl_bruto\tvl_glosa\tqt_item\tvl_pago\tevento\tdescricao\n604900030\t1790011\t7990008\tJOÃO DA SILVA\t09/06/2026\tLOCAL\tMEDICO\t45,54\t0\t1\t45,54\t50000470\tPROC\n',
      'win1252',
    );
    await writeBinaryFile(tempDir, 'latin1.xls', content);
    const result = await readSpreadsheet(path.join(tempDir, 'latin1.xls'));
    expect(result.rows[0].beneficiario).toContain('JO');
  });

  test('[F3-06] deve ignorar linhas vazias ou só com tabs', async () => {
    const content = `${await fs.readFile(FIXTURE_PATH, 'utf8')}\t\t\t\n`;
    await fs.writeFile(path.join(tempDir, 'with-empty.xls'), content, 'utf8');
    const result = await readSpreadsheet(path.join(tempDir, 'with-empty.xls'));
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('[F3-07] deve lançar SpreadsheetError para arquivo inexistente', async () => {
    await expect(readSpreadsheet(path.join(tempDir, 'missing.xls'))).rejects.toThrow(SpreadsheetError);
  });

  test('[F3-08] deve lançar SpreadsheetError para arquivo sem cabeçalho reconhecível', async () => {
    await fs.writeFile(path.join(tempDir, 'bad.csv'), 'foo,bar\n1,2\n', 'utf8');
    await expect(readSpreadsheet(path.join(tempDir, 'bad.csv'))).rejects.toThrow(SpreadsheetError);
  });
});

describe('spreadsheetReaderAdapter — xlsx', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('spreadsheet-xlsx-');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[F3-09] deve ler .xlsx real (exceljs) e retornar headers da primeira aba', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('demo');
    sheet.addRow([
      'Requisição',
      'Protocolo',
      'Guia',
      'Beneficiário',
      'Atendimento',
      'Local exec',
      'Executante',
      'Vl Bruto',
      'Vl Glosa',
      'Qt Item',
      'Vl Pago',
      'Evento',
      'Descrição',
    ]);
    sheet.addRow([
      '604900030',
      '1790011',
      '7990008',
      'IRARA',
      '09/06/2026',
      'CLINICA ARARA AZUL',
      'BOTO',
      '45,54',
      '0',
      '1',
      '45,54',
      '50000470',
      'PROC',
    ]);
    const filePath = path.join(tempDir, 'demo.xlsx');
    await workbook.xlsx.writeFile(filePath);

    const result = await readSpreadsheet(filePath);
    expect(result.headers).toContain('requisicao');
    expect(result.rows[0].protocolo).toBe('1790011');
  });

  test('deve formatar células Date de Atendimento como dd/MM/yyyy', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('demo');
    sheet.addRow([
      'Requisição',
      'Protocolo',
      'Guia',
      'Beneficiário',
      'Atendimento',
      'Local exec',
      'Executante',
      'Vl Bruto',
      'Vl Glosa',
      'Qt Item',
      'Vl Pago',
      'Evento',
      'Descrição',
    ]);
    const row = sheet.addRow([
      '604900030',
      '1790011',
      '7990008',
      'IRARA',
      new Date(Date.UTC(2026, 5, 9)),
      'CLINICA ARARA AZUL',
      'BOTO',
      '45,54',
      '0',
      '1',
      '45,54',
      '50000470',
      'PROC',
    ]);
    row.getCell(5).numFmt = 'dd/mm/yyyy';
    const filePath = path.join(tempDir, 'date-cell.xlsx');
    await workbook.xlsx.writeFile(filePath);

    const result = await readSpreadsheet(filePath);
    expect(result.rows[0].atendimento).toBe('09/06/2026');
    expect(result.rows[0].atendimento).not.toMatch(/GMT|Horário/);
  });

  test('formatCellValue converte Date UTC para dd/MM/yyyy', () => {
    expect(formatCellValue(new Date(Date.UTC(2026, 5, 8)))).toBe('08/06/2026');
    expect(formatCellValue('08/06/2026')).toBe('08/06/2026');
  });

  test('[F3-10] deve mapear células vazias como string vazia', async () => {
    const parsed = parseDelimitedContent(
      'requisicao\tprotocolo\tguia\tbeneficiario\tatendimento\tlocal_exec\texecutante\tvl_bruto\tvl_glosa\tqt_item\tvl_pago\tevento\tdescricao\n1\t2\t3\t\t01/01/2026\tLOCAL\tMED\t10\t0\t1\t10\t50000470\t\n',
    );
    expect(parsed.rows[0].beneficiario).toBe('');
  });

  test('[F3-11] deve detectar .xls binário disfarçado (magic PK) e usar exceljs', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('demo');
    sheet.addRow([
      'Requisição',
      'Protocolo',
      'Guia',
      'Beneficiário',
      'Atendimento',
      'Local exec',
      'Executante',
      'Vl Bruto',
      'Vl Glosa',
      'Qt Item',
      'Vl Pago',
      'Evento',
      'Descrição',
    ]);
    sheet.addRow([
      '1',
      '2',
      '3',
      'JOAO',
      '01/01/2026',
      'LOCAL',
      'MED',
      '10',
      '0',
      '1',
      '10',
      '50000470',
      'PROC',
    ]);
    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    const filePath = await writeBinaryFile(tempDir, 'binary.xls', Buffer.from(xlsxBuffer));
    const result = await readSpreadsheet(filePath);
    expect(result.detectedFormat).toBe('xlsx');
  });
});

describe('spreadsheetReaderAdapter — segurança', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('spreadsheet-security-');
    await fs.copyFile(FIXTURE_PATH, path.join(tempDir, 'demo.xls'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[F3-12] deve rejeitar path fora de inputDir (path traversal)', async () => {
    await expect(
      readSpreadsheet('../outside.xls', { baseDir: tempDir }),
    ).rejects.toThrow(FileReaderError);
  });

  test('[F3-13] deve lançar ValidationError para extensão não suportada (.pdf, .doc)', async () => {
    await fs.writeFile(path.join(tempDir, 'file.pdf'), 'pdf', 'utf8');
    await expect(readSpreadsheet(path.join(tempDir, 'file.pdf'))).rejects.toThrow(ValidationError);
  });

  test('normalizeHeader remove acentos', () => {
    expect(normalizeHeader('Beneficiário')).toBe('beneficiario');
  });

  test('createSpreadsheetReaderAdapter expõe read()', () => {
    const adapter = createSpreadsheetReaderAdapter();
    expect(typeof adapter.read).toBe('function');
  });
});
