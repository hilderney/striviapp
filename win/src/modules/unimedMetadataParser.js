const PRESTADOR_LINE_REGEX =
  /Prestador\s+(.+?)\s+Tipo guia:\s*.+?\s+Dt pesquisa:\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i;

function parseDateParts(dateStr) {
  const [day, month, year] = dateStr.split('/').map(Number);
  return { day, month, year };
}

function formatDate({ day, month, year }) {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${dd}/${mm}/${year}`;
}

function calculatePaymentDate(dtPesquisaFim) {
  const end = parseDateParts(dtPesquisaFim);
  let month = end.month + 1;
  let year = end.year;

  if (month > 12) {
    month = 1;
    year += 1;
  }

  return formatDate({ day: 5, month, year });
}

function buildPaymentLine(metadata) {
  const paymentDate = metadata.paymentDate || '';
  const inicio = metadata.dtPesquisaInicio || '';
  const fim = metadata.dtPesquisaFim || '';

  return `UNIMED - 1º PGTO PROGRAMADO PARA ${paymentDate} - - - - - - - - PRODUÇÃO : ${inicio} A ${fim}.`;
}

function parseUnimedMetadata(text) {
  const source = String(text || '');
  const match = source.match(PRESTADOR_LINE_REGEX);

  if (!match) {
    return {
      prestador: '',
      dtPesquisaInicio: '',
      dtPesquisaFim: '',
      paymentDate: '',
      paymentLine: '',
    };
  }

  const prestador = match[1].trim();
  const dtPesquisaInicio = match[2];
  const dtPesquisaFim = match[3];
  const paymentDate = calculatePaymentDate(dtPesquisaFim);

  const metadata = {
    prestador,
    dtPesquisaInicio,
    dtPesquisaFim,
    paymentDate,
  };

  return {
    ...metadata,
    paymentLine: buildPaymentLine({ ...metadata, paymentDate }),
  };
}

module.exports = {
  parseUnimedMetadata,
  buildPaymentLine,
  calculatePaymentDate,
  parseDateParts,
  formatDate,
};
