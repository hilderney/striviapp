function parseBrazilianMoney(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let cleaned = String(value)
    .replace(/\s*R\$\s*/gi, '')
    .replace(/\s/g, '')
    .trim();

  if (!cleaned || cleaned === '-') {
    return 0;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // BR: 1.234,56 ou 45,54
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    // US com milhar: 1,234.56
    cleaned = cleaned.replace(/,/g, '');
  } else if (lastDot !== -1) {
    // Só pontos: 45.54 (Excel/Drive) ou 1.234 / 1.234.567 (milhar BR)
    const parts = cleaned.split('.');
    if (parts.length > 2 || parts[1].length === 3) {
      cleaned = cleaned.replace(/\./g, '');
    }
  } else if (lastComma !== -1) {
    const parts = cleaned.split(',');
    if (parts.length > 2) {
      const decimals = parts[parts.length - 1];
      cleaned =
        decimals.length <= 2
          ? `${parts.slice(0, -1).join('')}.${decimals}`
          : parts.join('');
    } else {
      cleaned = cleaned.replace(',', '.');
    }
  }

  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function formatAmount(amount) {
  return amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBrazilianMoney(amount, { emptyAsDash = true } = {}) {
  if (!amount || amount <= 0) {
    return emptyAsDash ? '-' : 'R$ 0,00';
  }

  return `R$ ${formatAmount(amount)}`;
}

function formatSessionRate(amount) {
  if (!amount || amount <= 0) {
    return '-';
  }

  return `R$ ${formatAmount(amount)}`;
}

module.exports = {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
};
