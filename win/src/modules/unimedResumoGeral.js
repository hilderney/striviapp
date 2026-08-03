const {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
} = require('./unimedMoney');

const RESUMO_HEADERS = ['VR.SESSÕES', 'QUANT.', 'TOTAL'];
const RESUMO_LEFT_COLSPAN = 5;
const RESUMO_NAME_COLSPAN = 3;
const RESUMO_DATA_COLSPAN = 3;

function executanteShortName(executante) {
  return String(executante || '').trim().split(/\s+/)[0] || executante;
}

function spaceLetters(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((word) => word.split('').join(' '))
    .join('  ');
}

function resolveSessionRate(row) {
  const fromBruto = parseBrazilianMoney(row.vlBruto);
  if (fromBruto > 0) {
    return fromBruto;
  }

  const fromItem = parseBrazilianMoney(row.item);
  if (fromItem > 0) {
    return fromItem;
  }

  const fromPago = parseBrazilianMoney(row.vlPago);
  if (fromPago > 0) {
    return fromPago;
  }

  return 0;
}

function groupRowsBySessionRate(rows) {
  const groups = new Map();

  for (const row of rows) {
    const rate = resolveSessionRate(row);
    const key = rate.toFixed(2);

    if (!groups.has(key)) {
      groups.set(key, { rate, quantity: 0 });
    }

    groups.get(key).quantity += row.qt;
  }

  return [...groups.values()].sort((left, right) => right.rate - left.rate);
}

function collectGlobalRates(normalizedRows) {
  const rates = new Map();

  for (const row of normalizedRows) {
    const rate = resolveSessionRate(row);
    if (rate <= 0) {
      continue;
    }
    rates.set(rate.toFixed(2), rate);
  }

  return [...rates.values()].sort((left, right) => right - left);
}

function buildValueGroupRow(rate, quantity) {
  const totalAmount = rate * quantity;

  return {
    rateLabel: formatSessionRate(rate),
    quantity: String(quantity),
    totalLabel: quantity > 0 ? formatBrazilianMoney(totalAmount) : '-',
    totalAmount,
    quantityNum: quantity,
  };
}

function summarizeExecutanteRows(executante, rows, globalRates) {
  const quantityByRate = new Map(
    groupRowsBySessionRate(rows).map((group) => [group.rate.toFixed(2), group.quantity]),
  );

  const valueRows = globalRates.map((rate) =>
    buildValueGroupRow(rate, quantityByRate.get(rate.toFixed(2)) || 0),
  );

  const totalQuantity = valueRows.reduce((sum, row) => sum + row.quantityNum, 0);
  const totalAmount = valueRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const shortName = executanteShortName(executante);

  return {
    executante,
    shortName,
    spacedName: spaceLetters(shortName),
    valueRows,
    totalQuantity,
    totalAmount,
    totalLabel: formatBrazilianMoney(totalAmount, { emptyAsDash: false }),
  };
}

function mergeValueGroups(blocks, globalRates) {
  const quantityByRate = new Map();

  for (const block of blocks) {
    for (const valueRow of block.valueRows) {
      const rate = parseBrazilianMoney(valueRow.rateLabel);
      const key = rate.toFixed(2);
      quantityByRate.set(key, (quantityByRate.get(key) || 0) + valueRow.quantityNum);
    }
  }

  return globalRates.map((rate) =>
    buildValueGroupRow(rate, quantityByRate.get(rate.toFixed(2)) || 0),
  );
}

function buildResumoBlocks(normalizedRows) {
  const globalRates = collectGlobalRates(normalizedRows);
  const executantes = [];
  let index = 0;

  while (index < normalizedRows.length) {
    const executante = normalizedRows[index].executante;
    const groupRows = [];

    while (index < normalizedRows.length && normalizedRows[index].executante === executante) {
      groupRows.push(normalizedRows[index]);
      index += 1;
    }

    executantes.push(summarizeExecutanteRows(executante, groupRows, globalRates));
  }

  const grandValueRows = mergeValueGroups(executantes, globalRates);
  const grandTotalQuantity = executantes.reduce((sum, block) => sum + block.totalQuantity, 0);
  const grandTotalAmount = executantes.reduce((sum, block) => sum + block.totalAmount, 0);

  return {
    executantes,
    grandTotal: {
      spacedName: spaceLetters('TOTAL GERAL'),
      valueRows: grandValueRows,
      totalQuantity: grandTotalQuantity,
      totalAmount: grandTotalAmount,
      totalLabel: formatBrazilianMoney(grandTotalAmount, { emptyAsDash: false }),
    },
  };
}

function buildBlankResumoRow() {
  return { type: 'resumo-blank', cells: [''] };
}

function buildExecutanteResumoRows(block) {
  const rows = [
    {
      type: 'resumo-executante-start',
      cells: [block.spacedName, ...RESUMO_HEADERS],
      meta: {
        shortName: block.shortName,
        spacedName: block.spacedName,
        nameColspan: RESUMO_NAME_COLSPAN,
      },
    },
  ];

  for (const valueRow of block.valueRows) {
    rows.push({
      type: 'resumo-data',
      cells: [valueRow.rateLabel, valueRow.quantity, valueRow.totalLabel],
      meta: { shortName: block.shortName },
    });
  }

  rows.push({
    type: 'resumo-subtotal',
    cells: [`TOTAL - ${block.shortName}`, String(block.totalQuantity), block.totalLabel],
    meta: { shortName: block.shortName },
  });

  return rows;
}

function buildResumoGeralSheetRows(normalizedRows) {
  if (normalizedRows.length === 0) {
    return [];
  }

  const { executantes, grandTotal } = buildResumoBlocks(normalizedRows);
  const sheetRows = [
    { type: 'resumo-blank', cells: ['RESUMO GERAL'] },
  ];

  for (const block of executantes) {
    sheetRows.push(...buildExecutanteResumoRows(block));
    sheetRows.push(buildBlankResumoRow());
  }

  sheetRows.push({
    type: 'resumo-grand-start',
    cells: [grandTotal.spacedName, ...RESUMO_HEADERS],
    meta: {
      spacedName: grandTotal.spacedName,
      nameColspan: RESUMO_NAME_COLSPAN,
    },
  });

  for (const valueRow of grandTotal.valueRows) {
    sheetRows.push({
      type: 'resumo-data',
      cells: [valueRow.rateLabel, valueRow.quantity, valueRow.totalLabel],
      meta: { scope: 'grand-total' },
    });
  }

  sheetRows.push({
    type: 'resumo-grand-total',
    cells: ['TOTAL', String(grandTotal.totalQuantity), grandTotal.totalLabel],
  });
  sheetRows.push(buildBlankResumoRow());

  return sheetRows;
}

module.exports = {
  RESUMO_HEADERS,
  RESUMO_LEFT_COLSPAN,
  RESUMO_NAME_COLSPAN,
  RESUMO_DATA_COLSPAN,
  spaceLetters,
  resolveSessionRate,
  groupRowsBySessionRate,
  collectGlobalRates,
  buildResumoBlocks,
  buildResumoGeralSheetRows,
};
