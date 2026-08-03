const {
  buildPaymentLine,
  calculatePaymentDate,
  formatDate,
  parseDateParts,
} = require('./unimedMetadataParser');

function parseAtendimentoDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { day, month, year, sortKey: year * 10000 + month * 100 + day };
}

function compareDates(a, b) {
  return a.sortKey - b.sortKey;
}

function modeValue(values) {
  const counts = new Map();
  let best = '';
  let bestCount = 0;

  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      continue;
    }
    const count = (counts.get(trimmed) || 0) + 1;
    counts.set(trimmed, count);
    if (count > bestCount) {
      bestCount = count;
      best = trimmed;
    }
  }

  return best;
}

function getField(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function deriveSpreadsheetMetadata(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      prestador: '',
      dtPesquisaInicio: '',
      dtPesquisaFim: '',
      paymentDate: '',
      paymentLine: '',
    };
  }

  const localExecValues = rows.map((row) => getField(row, 'local_exec', 'local exec'));
  const prestador = modeValue(localExecValues);

  const parsedDates = rows
    .map((row) => parseAtendimentoDate(getField(row, 'atendimento')))
    .filter(Boolean)
    .sort(compareDates);

  const dtPesquisaInicio = parsedDates.length > 0 ? formatDate(parsedDates[0]) : '';
  const dtPesquisaFim =
    parsedDates.length > 0 ? formatDate(parsedDates[parsedDates.length - 1]) : '';
  const paymentDate = dtPesquisaFim ? calculatePaymentDate(dtPesquisaFim) : '';

  const metadata = {
    prestador,
    dtPesquisaInicio,
    dtPesquisaFim,
    paymentDate,
  };

  return {
    ...metadata,
    paymentLine: buildPaymentLine(metadata),
  };
}

module.exports = {
  deriveSpreadsheetMetadata,
  parseAtendimentoDate,
  modeValue,
  getField,
};
