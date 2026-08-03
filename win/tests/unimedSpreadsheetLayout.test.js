const {
  buildUnimedSpreadsheet,
  UNIMED_REPORT_HEADERS,
  COLUMN_COUNT,
  sortRows,
  normalizeRow,
} = require('../src/modules/unimedSpreadsheetLayout');

const SAMPLE_HEADER =
  'Prestador CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA Tipo guia: Guia Dt pesquisa: 20/05/2026 a 05/06/2026';

function sampleRows() {
  return [
    {
      guia: '7990003',
      dt_emis: '28/05/2026',
      beneficiario: 'HARPIA MAJESTOSA COELHO',
      pl: '13',
      medico: 'BOTO COR DE ROSA ALVES',
      requisicao: '604900058',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '1',
    },
    {
      guia: '7990004',
      dt_emis: '29/05/2026',
      beneficiario: 'ANA SILVA',
      pl: '14',
      medico: 'CORUJA BURAQUEIRA RAMOS',
      requisicao: '604900059',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '2',
    },
    {
      guia: '7990005',
      dt_emis: '30/05/2026',
      beneficiario: 'CARLA SOUZA',
      pl: '15',
      medico: 'BOTO COR DE ROSA ALVES',
      requisicao: '604900060',
      codigo_procedimento: '50000470',
      procedimento: 'PSICOTERAPIA INDIVIDUAL',
      qt: '1',
    },
  ];
}

describe('unimedSpreadsheetLayout', () => {
  test('ordena por Executante e Beneficiário', () => {
    const sorted = sortRows(sampleRows().map(normalizeRow));

    expect(sorted[0].executante).toBe('BOTO COR DE ROSA ALVES');
    expect(sorted[0].beneficiario).toBe('CARLA SOUZA');
    expect(sorted[1].beneficiario).toBe('HARPIA MAJESTOSA COELHO');
    expect(sorted[2].executante).toBe('CORUJA BURAQUEIRA RAMOS');
    expect(sorted[2].beneficiario).toBe('ANA SILVA');
  });

  test('monta preâmbulo, cabeçalho e placeholders monetários', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });

    expect(sheetRows[0].type).toBe('preamble');
    expect(sheetRows[0].cells[0]).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
    expect(sheetRows[0].meta).toEqual({ style: 'header1' });
    expect(sheetRows[1].type).toBe('preamble');
    expect(sheetRows[1].cells[0]).toContain('UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026');
    expect(sheetRows[1].meta).toEqual({ style: 'header3' });
    expect(sheetRows[2]).toEqual({ type: 'header', cells: [...UNIMED_REPORT_HEADERS] });
    expect(UNIMED_REPORT_HEADERS).toHaveLength(11);
    expect(COLUMN_COUNT).toBe(11);
    expect(UNIMED_REPORT_HEADERS).not.toContain('Item');

    const firstData = sheetRows.find((row) => row.type === 'data');
    expect(firstData.cells).toHaveLength(11);
    expect(firstData.cells[6]).toBe('Consulta/Terapia');
    expect(firstData.cells[8]).toBe('R$ 0,00');
    expect(firstData.cells[10]).toBe('R$ 0,00');
  });

  test('insere subtotal por Executante e TOTAL GERAL', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });

    const subtotals = sheetRows.filter((row) => row.type === 'subtotal');
    const blankBeforeGrand = sheetRows.findIndex((row) => row.type === 'blank');
    const grandTotal = sheetRows.find((row) => row.type === 'grand-total');

    expect(subtotals).toHaveLength(2);
    expect(subtotals[0].cells[0]).toBe('TOTAL - BOTO');
    expect(subtotals[0].cells[7]).toBe('2');
    expect(subtotals[1].cells[0]).toBe('TOTAL - CORUJA');
    expect(subtotals[1].cells[7]).toBe('2');
    expect(blankBeforeGrand).toBeGreaterThan(-1);
    expect(sheetRows[blankBeforeGrand + 1].type).toBe('grand-total');
    expect(grandTotal.cells[0]).toBe('TOTAL GERAL');
    expect(grandTotal.cells[7]).toBe('4');
    expect(sheetRows.some((row) => row.type === 'resumo-subtotal')).toBe(true);
    expect(sheetRows.some((row) => row.type === 'resumo-grand-total')).toBe(true);
  });

  test('soma valores monetários nos subtotais', () => {
    const rows = [
      {
        protocolo: '1',
        guia: '2',
        requisicao: '3',
        beneficiario: 'A',
        dt_emis: '01/01/2026',
        medico: 'BOTO COR DE ROSA ALVES',
        codigo_procedimento: '50000470',
        qt: '1',
        vl_bruto: '40,42',
        vl_glosa: '0',
        vl_pago: '40,42',
      },
      {
        protocolo: '1',
        guia: '3',
        requisicao: '4',
        beneficiario: 'B',
        dt_emis: '02/01/2026',
        medico: 'BOTO COR DE ROSA ALVES',
        codigo_procedimento: '50000470',
        qt: '2',
        vl_bruto: '45,54',
        vl_glosa: '5,00',
        vl_pago: '40,54',
      },
    ];

    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows });
    const subtotal = sheetRows.find((row) => row.type === 'subtotal');

    expect(subtotal.cells[7]).toBe('3');
    expect(subtotal.cells[8]).toBe('R$ 85,96');
    expect(subtotal.cells[9]).toBe('R$ 5,00');
    expect(subtotal.cells[10]).toBe('R$ 80,96');
  });

  test('mapeia colunas conforme layout Unimed', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: [sampleRows()[0]] });
    const data = sheetRows.find((row) => row.type === 'data');

    expect(data.cells[0]).toBe('604900058');
    expect(data.cells[1]).toBe('7990003');
    expect(data.cells[2]).toBe('13');
    expect(data.cells[3]).toBe('HARPIA MAJESTOSA COELHO');
    expect(data.cells[5]).toBe('BOTO COR DE ROSA ALVES');
  });

  test('[F3-43] deve usar metadata.prestador quando passada, ignorando parseUnimedMetadata(text)', () => {
    const { sheetRows, metadata } = buildUnimedSpreadsheet({
      text: '',
      rows: sampleRows(),
      metadata: {
        prestador: 'PRESTADOR INJETADO',
        paymentLine: 'LINHA INJETADA',
      },
    });

    expect(metadata.prestador).toBe('PRESTADOR INJETADO');
    expect(sheetRows[0].cells[0]).toBe('PRESTADOR INJETADO');
  });

  test('[F3-44] deve usar metadata.paymentLine no preamble linha 2', () => {
    const { sheetRows } = buildUnimedSpreadsheet({
      text: '',
      rows: sampleRows(),
      metadata: {
        prestador: 'PRESTADOR',
        paymentLine: 'PAGAMENTO INJETADO',
      },
    });

    expect(sheetRows[1].cells[0]).toBe('PAGAMENTO INJETADO');
  });

  test('[F3-45] fallback: sem metadata, continua usando parseUnimedMetadata(text) (regressão Fase 1)', () => {
    const { sheetRows } = buildUnimedSpreadsheet({ text: SAMPLE_HEADER, rows: sampleRows() });
    expect(sheetRows[0].cells[0]).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
  });

  test('[F3-46] deve formatar vl_glosa=0 como -', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '45,54',
      vl_bruto: '45,54',
      vl_glosa: '0',
      vl_pago: '45,54',
    });
    expect(normalized.vlGlosa).toBe('-');
  });

  test('[F3-47] deve formatar vl_glosa=10,50 como R$ 10,50', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '40,42',
      vl_bruto: '40,42',
      vl_glosa: '10,50',
      vl_pago: '29,92',
    });
    expect(normalized.vlGlosa).toBe('R$ 10,50');
  });

  test('[F3-48] deve usar Vl Bruto quando > 0 para RESUMO GERAL', () => {
    const normalized = normalizeRow({
      protocolo: '1',
      guia: '2',
      requisicao: '3',
      beneficiario: 'A',
      dt_emis: '01/01/2026',
      medico: 'MED',
      codigo_procedimento: '50000470',
      qt: '1',
      item: '45,54',
      vl_bruto: '45,54',
      vl_glosa: '0',
      vl_pago: '45,54',
    });
    expect(normalized.vlBruto).toBe('R$ 45,54');
    expect(normalized.item).toBeUndefined();
  });
});
