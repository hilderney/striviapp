const path = require('path');
const { readSpreadsheet } = require('../src/adapters/spreadsheetReaderAdapter');
const { createTableParserAdapter } = require('../src/adapters/tableParserAdapter');
const { SpreadsheetError } = require('../src/errors');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');

describe('unimedPlanilhaParser', () => {
  let spreadsheet;
  let parser;

  beforeAll(async () => {
    spreadsheet = await readSpreadsheet(FIXTURE_PATH);
    parser = createTableParserAdapter('unimed-planilha');
  });

  test('[F3-14] deve mapear colunas nativas para shape intermediário (requisicao, protocolo, guia...)', () => {
    const parsed = parser.parseSpreadsheet(spreadsheet);
    const row = parsed.rows[0];

    expect(row.requisicao).toBe('604900030');
    expect(row.protocolo).toBe('1790011');
    expect(row.guia).toBe('7990008');
    expect(row.beneficiario).toContain('IRARA');
    expect(row.dt_emis).toBe('09/06/2026');
    expect(row.medico).toContain('BOTO');
  });

  test('[F3-15] deve mapear Evento 50000470 para codigo_procedimento e procedimento da Descrição', () => {
    const parsed = parser.parseSpreadsheet(spreadsheet);
    const row = parsed.rows[0];

    expect(row.codigo_procedimento).toBe('50000470');
    expect(row.procedimento).toContain('PSICOTERAPIA');
  });

  test('[F3-16] deve preservar valores monetários como string (vl_bruto, vl_pago, vl_glosa)', () => {
    const parsed = parser.parseSpreadsheet(spreadsheet);
    const row = parsed.rows.find((item) => item.vl_glosa === '10,50');

    expect(row.vl_bruto).toBe('40,42');
    expect(row.vl_pago).toBe('29,92');
    expect(row.vl_glosa).toBe('10,50');
  });

  test('[F3-17] deve usar Vl Bruto como item (valor unitário da sessão)', () => {
    const parsed = parser.parseSpreadsheet(spreadsheet);
    expect(parsed.rows[0].item).toBe('45,54');
  });

  test('[F3-18] deve ignorar linha sem Requisição ou sem Executante', () => {
    const parsed = parser.parseSpreadsheet({
      headers: spreadsheet.headers,
      rows: [
        { ...spreadsheet.rows[0], requisicao: '', executante: 'MEDICO' },
        { ...spreadsheet.rows[0], requisicao: '123', executante: '' },
      ],
    });

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skippedLines).toHaveLength(2);
  });

  test('[F3-19] deve retornar parser: unimed-planilha', () => {
    const parsed = parser.parseSpreadsheet(spreadsheet);
    expect(parsed.parser).toBe('unimed-planilha');
  });

  test('[F3-20] deve lançar SpreadsheetError se colunas obrigatórias ausentes', () => {
    expect(() =>
      parser.parseSpreadsheet({ headers: ['requisicao'], rows: [{ requisicao: '1' }] }),
    ).toThrow(SpreadsheetError);
  });

  test('[F3-21] deve aceitar headers com variações de acento (Beneficiário / Beneficiario)', async () => {
    const altSpreadsheet = await readSpreadsheet(FIXTURE_PATH);
    altSpreadsheet.headers = altSpreadsheet.headers.map((header) =>
      header === 'beneficiario' ? 'beneficiario' : header,
    );
    const parsed = parser.parseSpreadsheet(altSpreadsheet);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });
});
