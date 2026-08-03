const { SpreadsheetError } = require('../errors');
const {
  REQUIRED_HEADER_KEYS,
} = require('./spreadsheetReaderAdapter');

const SKIP_LINE_PATTERNS = [
  /^Controle de Guias$/i,
  /^Guia\s+Dt\s+Emis/i,
  /^Impresso em:/i,
  /^Prestador\s+/i,
  /UNIMED.*COOPERATIVA/i,
  /Tipo guia:/i,
  /Dt pesquisa:/i,
  /^\s*$/,
  /Página\s+\d+/i,
  /^Total de\b/i,
  /^CPLS\d+/i,
];

const GUIA_LINE_REGEX =
  /^(\d{7})\s+(\d{2}\/\d{2}\/\d{2,4})\s+(.+)\s+REQUISIÇÃO:\s*(\d+)\s*$/i;

const PROCEDURE_LINE_REGEX =
  /^(\d{8})\s+(.+?)\s+(?:POR\s+)?(\d+)\s*$/i;

function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  return SKIP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function parseGuiaLine(line) {
  const match = line.trim().match(GUIA_LINE_REGEX);
  if (!match) {
    return null;
  }

  const [, guia, dtEmis, middle, requisicao] = match;
  const idMatch = middle.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!idMatch) {
    return null;
  }

  return {
    guia,
    dt_emis: dtEmis,
    beneficiario: idMatch[1].trim(),
    id_beneficiario: idMatch[2],
    pl: idMatch[3],
    medico: idMatch[4].trim(),
    requisicao,
  };
}

function parseProcedureLine(line) {
  const match = line.trim().match(PROCEDURE_LINE_REGEX);
  if (!match) {
    return null;
  }

  return {
    codigo_procedimento: match[1],
    procedimento: match[2].trim(),
    qt: match[3],
  };
}

class TableParserAdapter {
  parse(_text) {
    throw new Error('TableParserAdapter.parse() must be implemented');
  }
}

class UnimedGuiaTableParser extends TableParserAdapter {
  parse(text) {
    const lines = String(text || '').split(/\r?\n/);
    const rows = [];
    const skippedLines = [];
    let pendingGuia = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (shouldSkipLine(line)) {
        skippedLines.push(line);
        continue;
      }

      const guia = parseGuiaLine(line);
      if (guia) {
        pendingGuia = guia;
        continue;
      }

      const procedure = parseProcedureLine(line);
      if (procedure) {
        if (pendingGuia) {
          rows.push({ ...pendingGuia, ...procedure });
          pendingGuia = null;
        } else {
          skippedLines.push(line);
        }
        continue;
      }

      skippedLines.push(line);
    }

    return {
      rows,
      skippedLines,
      parser: 'unimed-guia',
    };
  }
}

class UnimedPlanilhaTableParser extends TableParserAdapter {
  parseSpreadsheet(data) {
    const headers = data?.headers || [];
    const sourceRows = data?.rows || [];
    const skippedLines = [];
    const rows = [];

    const missing = [...REQUIRED_HEADER_KEYS].filter((key) => !headers.includes(key));
    if (missing.length > 0) {
      throw new SpreadsheetError(`Missing required columns: ${missing.join(', ')}`, {
        code: 'MISSING_COLUMNS',
      });
    }

    for (const sourceRow of sourceRows) {
      const requisicao = String(sourceRow.requisicao || '').trim();
      const executante = String(sourceRow.executante || '').trim();

      if (!requisicao || !executante) {
        skippedLines.push(JSON.stringify(sourceRow));
        continue;
      }

      rows.push({
        requisicao,
        protocolo: String(sourceRow.protocolo || '').trim(),
        guia: String(sourceRow.guia || '').trim(),
        beneficiario: String(sourceRow.beneficiario || '').trim(),
        dt_emis: String(sourceRow.atendimento || '').trim(),
        medico: executante,
        codigo_procedimento: String(sourceRow.evento || '').trim(),
        procedimento: String(sourceRow.descricao || '').trim(),
        qt: String(sourceRow.qt_item || sourceRow.qt || '').trim(),
        item: String(sourceRow.vl_bruto || '').trim(),
        vl_bruto: String(sourceRow.vl_bruto || '').trim(),
        vl_glosa: String(sourceRow.vl_glosa ?? '').trim(),
        vl_pago: String(sourceRow.vl_pago || '').trim(),
      });
    }

    return {
      rows,
      skippedLines,
      parser: 'unimed-planilha',
    };
  }

  parse(_text) {
    throw new SpreadsheetError('unimed-planilha parser requires parseSpreadsheet(data)', {
      code: 'UNSUPPORTED_FORMAT',
    });
  }
}

class GenericTableParser extends TableParserAdapter {
  parse(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const rows = [];
    const skippedLines = [];

    for (const line of lines) {
      if (shouldSkipLine(line)) {
        skippedLines.push(line);
        continue;
      }

      const guia = parseGuiaLine(line);
      if (guia) {
        rows.push({ ...guia, row_type: 'guia' });
        continue;
      }

      const procedure = parseProcedureLine(line);
      if (procedure) {
        rows.push({ ...procedure, row_type: 'procedimento' });
        continue;
      }

      if (/^\d{4,}/.test(line)) {
        rows.push({ row_type: 'data', content: line });
        continue;
      }

      skippedLines.push(line);
    }

    return {
      rows,
      skippedLines,
      parser: 'generic',
    };
  }
}

function createTableParserAdapter(type = 'auto') {
  switch (type) {
    case 'unimed-planilha':
      return new UnimedPlanilhaTableParser();
    case 'unimed-guia':
      return new UnimedGuiaTableParser();
    case 'generic':
      return new GenericTableParser();
    case 'auto': {
      const unimed = new UnimedGuiaTableParser();
      return {
        parse(text) {
          const unimedResult = unimed.parse(text);
          if (unimedResult.rows.length > 0) {
            return unimedResult;
          }

          return new GenericTableParser().parse(text);
        },
      };
    }
    default:
      throw new Error(`Unknown table parser adapter: ${type}`);
  }
}

module.exports = {
  TableParserAdapter,
  UnimedGuiaTableParser,
  UnimedPlanilhaTableParser,
  GenericTableParser,
  createTableParserAdapter,
  shouldSkipLine,
  parseGuiaLine,
  parseProcedureLine,
  TABLE_EXPORT_HEADERS: [
    { id: 'source_pdf', title: 'source_pdf' },
    { id: 'guia', title: 'guia' },
    { id: 'dt_emis', title: 'dt_emis' },
    { id: 'beneficiario', title: 'beneficiario' },
    { id: 'id_beneficiario', title: 'id_beneficiario' },
    { id: 'pl', title: 'pl' },
    { id: 'medico', title: 'medico' },
    { id: 'requisicao', title: 'requisicao' },
    { id: 'codigo_procedimento', title: 'codigo_procedimento' },
    { id: 'procedimento', title: 'procedimento' },
    { id: 'qt', title: 'qt' },
  ],
};
