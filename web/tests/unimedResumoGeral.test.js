const {
  buildResumoBlocks,
  buildResumoGeralSheetRows,
  groupRowsBySessionRate,
  spaceLetters,
} = require('../src/modules/unimedResumoGeral');
const { normalizeRow } = require('../src/modules/unimedSpreadsheetLayout');
const {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
} = require('../src/modules/unimedMoney');

function rowWithValue(overrides) {
  return {
    guia: '100',
    dt_emis: '01/01/2026',
    beneficiario: 'PACIENTE TESTE',
    pl: '1',
    medico: 'BOTO COR DE ROSA ALVES',
    requisicao: '600',
    codigo_procedimento: '50000470',
    procedimento: 'PSICOTERAPIA',
    qt: '1',
    item: '45,54',
    vl_bruto: '45,54',
    vlPago: '45,54',
    ...overrides,
  };
}

describe('unimedMoney', () => {
  test('parseia e formata valores em reais', () => {
    expect(parseBrazilianMoney('45,54 R$')).toBeCloseTo(45.54);
    expect(parseBrazilianMoney('R$ 1.092,96')).toBeCloseTo(1092.96);
    expect(formatBrazilianMoney(1092.96)).toBe('R$ 1.092,96');
    expect(formatSessionRate(40.42)).toBe('R$ 40,42');
    expect(formatBrazilianMoney(0)).toBe('-');
  });

  test('aceita decimal com ponto (Excel / Google Sheets / Drive)', () => {
    expect(parseBrazilianMoney('45.54')).toBeCloseTo(45.54);
    expect(parseBrazilianMoney(45.54)).toBeCloseTo(45.54);
    expect(parseBrazilianMoney('1,092.96')).toBeCloseTo(1092.96);
    expect(parseBrazilianMoney('R$ 45.54')).toBeCloseTo(45.54);
  });

  test('mantém formato brasileiro com milhar e vírgula', () => {
    expect(parseBrazilianMoney('45,54')).toBeCloseTo(45.54);
    expect(parseBrazilianMoney('1.092,96')).toBeCloseTo(1092.96);
    expect(parseBrazilianMoney('1.234')).toBeCloseTo(1234);
  });
});

describe('unimedResumoGeral', () => {
  test('agrupa valores de sessão por Executante usando Vl Bruto', () => {
    const rows = [
      rowWithValue({ qt: '2', vl_bruto: '45,54', vlPago: '45,54' }),
      rowWithValue({ qt: '1', vl_bruto: '40,42', vlPago: '40,42' }),
      rowWithValue({
        medico: 'CORUJA BURAQUEIRA RAMOS',
        qt: '3',
        vl_bruto: '40,42',
        vlPago: '40,42',
      }),
    ].map(normalizeRow);

    const { executantes, grandTotal } = buildResumoBlocks(rows);

    expect(executantes).toHaveLength(2);
    expect(executantes[0].shortName).toBe('BOTO');
    expect(executantes[0].valueRows).toHaveLength(2);
    expect(executantes[0].valueRows[0].rateLabel).toBe('R$ 45,54');
    expect(executantes[0].valueRows[0].quantity).toBe('2');
    expect(executantes[0].valueRows[0].totalLabel).toBe('R$ 91,08');
    expect(executantes[0].valueRows[1].quantity).toBe('1');
    expect(executantes[1].valueRows[0].quantity).toBe('0');
    expect(executantes[1].valueRows[1].quantity).toBe('3');
    expect(executantes[0].totalQuantity).toBe(3);
    expect(executantes[1].totalQuantity).toBe(3);
    expect(grandTotal.totalQuantity).toBe(6);
    expect(grandTotal.totalLabel).toBe('R$ 252,76');
  });

  test('monta linhas do RESUMO GERAL com blocos por Executante', () => {
    const rows = [
      rowWithValue({ qt: '1', vl_bruto: '45,54', vlPago: '45,54' }),
      rowWithValue({
        medico: 'CORUJA BURAQUEIRA RAMOS',
        qt: '2',
        vl_bruto: '40,42',
        vlPago: '40,42',
      }),
    ].map(normalizeRow);

    const sheetRows = buildResumoGeralSheetRows(rows);
    const content = sheetRows.map((row) => row.cells.join('\t')).join('\n');

    expect(sheetRows[0].type).toBe('resumo-separator');
    expect(content).toContain('RESUMO GERAL');
    expect(content).toContain('B O T O');
    expect(content).toContain('C O R U J A');
    expect(content).toContain('VR.SESSÕES');
    expect(content).toContain('TOTAL - BOTO');
    expect(content).toContain('TOTAL - CORUJA');
    expect(content).toContain('T O T A L  G E R A L');
    expect(sheetRows.some((row) => row.type === 'resumo-grand-total')).toBe(true);
    expect(sheetRows.find((row) => row.type === 'resumo-grand-total').cells[0]).toBe('TOTAL');
  });

  test('espaça letras do nome do Executante', () => {
    expect(spaceLetters('BOTO')).toBe('B O T O');
    expect(spaceLetters('TOTAL GERAL')).toBe('T O T A L  G E R A L');
  });

  test('agrupa apenas valores que apareceram nos dados', () => {
    const groups = groupRowsBySessionRate([
      normalizeRow(rowWithValue({ qt: '2', vl_bruto: '45,54' })),
      normalizeRow(rowWithValue({ qt: '1', vl_bruto: '40,42' })),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].rate).toBeCloseTo(45.54);
    expect(groups[1].rate).toBeCloseTo(40.42);
  });
});
