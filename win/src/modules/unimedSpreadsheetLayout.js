const { parseUnimedMetadata } = require('./unimedMetadataParser');
const { buildResumoGeralSheetRows } = require('./unimedResumoGeral');
const { parseBrazilianMoney, formatBrazilianMoney } = require('./unimedMoney');

const UNIMED_REPORT_HEADERS = [
  'Requisição',
  'Protocolo',
  'Guia',
  'Beneficiário',
  'Atendimento',
  'Executante',
  'Serviço',
  'Qt',
  'Vl Bruto',
  'Vl Glosa',
  'Vl Pago',
];

const COLUMN_COUNT = UNIMED_REPORT_HEADERS.length;
const SUBTOTAL_LABEL_COLSPAN = 5;

const SERVICE_LABELS = {
  '50000470': 'Consulta/Terapia',
  '50001221': 'Consulta Ambulatorial',
};

const PLACEHOLDER_BRUTO = 'R$ 0,00';
const PLACEHOLDER_GLOSA = '-';
const PLACEHOLDER_PAGO = 'R$ 0,00';

function mapServiceLabel(row) {
  if (row.codigo_procedimento && SERVICE_LABELS[row.codigo_procedimento]) {
    return SERVICE_LABELS[row.codigo_procedimento];
  }

  const proc = String(row.procedimento || '').toUpperCase();
  if (proc.includes('PSICOTERAPIA')) {
    return 'Consulta/Terapia';
  }
  if (proc.includes('CONSULTA AMBULATORIAL')) {
    return 'Consulta Ambulatorial';
  }

  return row.procedimento || 'Consulta/Terapia';
}

function resolveMoneyField(row, ...fields) {
  for (const field of fields) {
    const value = row[field];
    if (value && value !== '-') {
      return value;
    }
  }
  return null;
}

function formatMoneyOutput(value) {
  if (value == null || value === '' || value === '-') {
    return null;
  }

  if (String(value).includes('R$')) {
    const amount = parseBrazilianMoney(value);
    if (amount <= 0) {
      return null;
    }
    return formatBrazilianMoney(amount, { emptyAsDash: false });
  }

  const amount = parseBrazilianMoney(value);
  if (amount <= 0) {
    return null;
  }

  return formatBrazilianMoney(amount, { emptyAsDash: false });
}

function normalizeRow(row) {
  const item = resolveMoneyField(row, 'item');
  const vlPago = resolveMoneyField(row, 'vlPago', 'vl_pago');
  const vlBruto = resolveMoneyField(row, 'vlBruto', 'vl_bruto');
  const vlGlosaRaw = resolveMoneyField(row, 'vlGlosa', 'vl_glosa');

  const brutoFormatted = formatMoneyOutput(vlBruto || item);
  const pagoFormatted = formatMoneyOutput(vlPago);
  const glosaAmount = parseBrazilianMoney(vlGlosaRaw);

  const hasPlanilhaShape = Boolean(row.protocolo);

  return {
    requisicao: row.requisicao || '',
    protocolo: hasPlanilhaShape ? row.protocolo || '' : row.guia || '',
    guia: hasPlanilhaShape ? row.guia || '' : row.pl || '',
    beneficiario: row.beneficiario || '',
    atendimento: row.dt_emis || '',
    executante: row.medico || row.executante || '',
    servico: mapServiceLabel(row),
    qt: Number.parseInt(row.qt, 10) || 0,
    vlBruto: brutoFormatted || PLACEHOLDER_BRUTO,
    vlGlosa: glosaAmount > 0 ? formatBrazilianMoney(glosaAmount, { emptyAsDash: false }) : PLACEHOLDER_GLOSA,
    vlPago: pagoFormatted || PLACEHOLDER_PAGO,
  };
}

function rowToCells(normalized) {
  return [
    normalized.requisicao,
    normalized.protocolo,
    normalized.guia,
    normalized.beneficiario,
    normalized.atendimento,
    normalized.executante,
    normalized.servico,
    String(normalized.qt),
    normalized.vlBruto,
    normalized.vlGlosa,
    normalized.vlPago,
  ];
}

function comparePt(a, b) {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const byExecutante = comparePt(a.executante, b.executante);
    if (byExecutante !== 0) {
      return byExecutante;
    }
    return comparePt(a.beneficiario, b.beneficiario);
  });
}

function executanteShortName(executante) {
  return String(executante || '').trim().split(/\s+/)[0] || executante;
}

function buildSubtotalCells(label, service, totals) {
  const cells = new Array(COLUMN_COUNT).fill('');
  cells[0] = label;
  cells[6] = service;
  cells[7] = String(totals.qt);
  cells[8] = totals.vlBruto;
  cells[9] = totals.vlGlosa;
  cells[10] = totals.vlPago;
  return cells;
}

function emptyTotals() {
  return {
    qt: 0,
    vlBrutoAmount: 0,
    vlGlosaAmount: 0,
    vlPagoAmount: 0,
  };
}

function formatTotals(totals) {
  return {
    qt: totals.qt,
    vlBruto: formatBrazilianMoney(totals.vlBrutoAmount, { emptyAsDash: false }),
    vlGlosa:
      totals.vlGlosaAmount > 0
        ? formatBrazilianMoney(totals.vlGlosaAmount, { emptyAsDash: false })
        : PLACEHOLDER_GLOSA,
    vlPago: formatBrazilianMoney(totals.vlPagoAmount, { emptyAsDash: false }),
  };
}

function addToTotals(totals, row) {
  totals.qt += row.qt;
  totals.vlBrutoAmount += parseBrazilianMoney(row.vlBruto);
  totals.vlGlosaAmount += parseBrazilianMoney(row.vlGlosa);
  totals.vlPagoAmount += parseBrazilianMoney(row.vlPago);
}

function buildGroupedSheetRows(normalizedRows) {
  const sheetRows = [];
  let index = 0;

  while (index < normalizedRows.length) {
    const executante = normalizedRows[index].executante;
    const group = [];

    while (index < normalizedRows.length && normalizedRows[index].executante === executante) {
      group.push(normalizedRows[index]);
      index += 1;
    }

    for (const row of group) {
      sheetRows.push({ type: 'data', cells: rowToCells(row) });
    }

    const totals = emptyTotals();
    for (const row of group) {
      addToTotals(totals, row);
    }

    sheetRows.push({
      type: 'subtotal',
      cells: buildSubtotalCells(
        `TOTAL - ${executanteShortName(executante)}`,
        group[0]?.servico || 'Consulta/Terapia',
        formatTotals(totals),
      ),
      meta: { labelColspan: SUBTOTAL_LABEL_COLSPAN },
    });
  }

  return sheetRows;
}

function buildGrandTotalRows(normalizedRows) {
  const totals = emptyTotals();
  const services = new Set(normalizedRows.map((row) => row.servico));

  for (const row of normalizedRows) {
    addToTotals(totals, row);
  }

  const serviceLabel = services.size === 1 ? [...services][0] : 'Consulta/Terapia';

  return {
    type: 'grand-total',
    cells: buildSubtotalCells('TOTAL GERAL', serviceLabel, formatTotals(totals)),
    meta: { labelColspan: SUBTOTAL_LABEL_COLSPAN },
  };
}

function buildUnimedSpreadsheet({ text, rows, metadata }) {
  const resolvedMetadata = metadata ?? parseUnimedMetadata(text);
  const prestador = String(resolvedMetadata.prestador || '').toUpperCase();
  const normalizedRows = sortRows(rows.map(normalizeRow));
  const dataAndSubtotals = buildGroupedSheetRows(normalizedRows);

  const sheetRows = [
    { type: 'preamble', cells: [prestador], meta: { style: 'header1' } },
    {
      type: 'preamble',
      cells: [resolvedMetadata.paymentLine],
      meta: { style: 'header3' },
    },
    { type: 'header', cells: [...UNIMED_REPORT_HEADERS] },
    ...dataAndSubtotals,
  ];

  if (normalizedRows.length > 0) {
    sheetRows.push({ type: 'blank', cells: new Array(COLUMN_COUNT).fill('') });
    sheetRows.push(buildGrandTotalRows(normalizedRows));
    sheetRows.push(...buildResumoGeralSheetRows(normalizedRows));
  }

  return {
    sheetRows,
    columnCount: COLUMN_COUNT,
    metadata: { ...resolvedMetadata, prestador },
    dataRowCount: normalizedRows.length,
  };
}

module.exports = {
  UNIMED_REPORT_HEADERS,
  COLUMN_COUNT,
  SUBTOTAL_LABEL_COLSPAN,
  mapServiceLabel,
  normalizeRow,
  buildUnimedSpreadsheet,
  sortRows,
  executanteShortName,
};
