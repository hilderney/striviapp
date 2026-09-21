const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportCsv, exportXlsx, resolveExportRows } = require('../src/modules/exporter');
const { ExportError } = require('../src/errors');
const { createTempDir } = require('./helpers/fixtures');

const UNIMED_SAMPLE_PATH = path.join(__dirname, 'fixtures', 'unimed-guias-sample.txt');

function buildResult(overrides = {}) {
  return {
    inputFile: 'doc.pdf',
    outputFile: '/tmp/output/doc.txt',
    pageCount: 2,
    charCount: 20,
    text: 'Texto extraído...',
    extractedAt: '2026-06-29T15:00:00.000Z',
    ...overrides,
  };
}

async function readWorksheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets[0];
}

function borderStyle(cell, side) {
  const style = cell.border?.[side]?.style;
  return style === 'thick' ? 'medium' : style;
}

function rawBorderStyle(cell, side) {
  return cell.border?.[side]?.style;
}

describe('exporter — CSV (layout Unimed)', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-csv-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-19] deve gerar CSV com prestador, linha UNIMED e cabeçalho de 11 colunas', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportCsv(
      [buildResult({ inputFile: 'unimed.pdf', text: sampleText })],
      outputDir,
      { fileName: 'export.csv' },
    );
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');

    expect(lines[0]).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
    expect(lines[1]).toContain('UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026');
    expect(lines[1]).toContain('PRODUÇÃO : 20/05/2026 A 05/06/2026');
    expect(lines[2]).toContain('Requisição');
    expect(lines[2]).toContain('Executante');
    expect(lines[2]).toContain('Vl Pago');
    expect(lines[2]).not.toContain('Item');
    expect(lines[2].split('\t')).toHaveLength(11);
    expect(content).toContain('7990003');
    expect(content).toContain('TOTAL - BOTO');
    expect(content).toContain('TOTAL GERAL');
    expect(content).toContain('RESUMO GERAL');
    expect(content).toContain('VR.SESSÕES');
    expect(content).not.toContain('source_pdf');
    expect(content).not.toContain('Controle de Guias');
    expect(content).not.toContain('Total de beneficiários');
  });

  test('[RED-20] deve aceitar array de resultados de extração como entrada', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const results = [
      buildResult({ inputFile: 'a.pdf', text: sampleText }),
      buildResult({ inputFile: 'b.pdf', text: sampleText }),
    ];

    const { filePath, rowCount } = await exportCsv(results, outputDir, { fileName: 'export.csv' });
    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');

    expect(rowCount).toBe(8);
    expect(lines.length).toBeGreaterThan(9);
  });

  test('[RED-21] deve preservar campos com vírgula e aspas no layout tabular', async () => {
    const text = [
      'Prestador CLINICA TESTE Tipo guia: SP/SADT Dt pesquisa: 01/01/2026 a 31/01/2026',
      '7990003 28/05/202 MARIA, DA SILVA 25 13 DR. TESTE REQUISIÇÃO: 604900058',
      '50000470 PROCEDIMENTO COM "ASPAS" POR 1',
    ].join('\n');

    const { filePath } = await exportCsv([buildResult({ text })], outputDir, { fileName: 'export.csv' });
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('MARIA, DA SILVA');
    expect(content).toContain('Consulta/Terapia');
  });

  test('[RED-22] deve retornar o caminho absoluto do arquivo .csv gerado', async () => {
    const { filePath } = await exportCsv([buildResult({ inputFile: 'relatorio.pdf' })], outputDir, {
      fallbackToRaw: true,
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(path.basename(filePath)).toBe('relatorio_pdf.csv');
  });

  test('nome padrão do arquivo deve seguir o nome do PDF de origem', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportCsv(
      [buildResult({ inputFile: 'Produção unimed pgto070726.PDF', text: sampleText })],
      outputDir,
    );

    expect(path.basename(filePath)).toBe('Produ__o_unimed_pgto070726_pdf.csv');
  });

  test('[RED-23] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportCsv([], outputDir)).rejects.toThrow(ExportError);
  });

  test('usa fallback raw quando não há tabela e fallback está habilitado', async () => {
    const resolved = resolveExportRows([buildResult()], { fallbackToRaw: true });
    expect(resolved.mode).toBe('raw');
    expect(resolved.rows[0].content).toBe('Texto extraído...');
  });

  test('format legacy mantém colunas técnicas flat', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportCsv(
      [buildResult({ text: sampleText })],
      outputDir,
      { format: 'legacy', fileName: 'legacy.csv' },
    );
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('source_pdf');
    expect(content).toContain('codigo_procedimento');
    expect(content).not.toContain('TOTAL GERAL');
  });
});

describe('exporter — Excel (layout Unimed)', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('exporter-xlsx-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-24] deve gerar um arquivo .xlsx com planilha documents', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );

    const worksheet = await readWorksheet(filePath);
    expect(worksheet).toBeDefined();
    expect(worksheet.name).toBe('documents');
  });

  test('[RED-25] deve incluir prestador, linha UNIMED e cabeçalho de 11 colunas', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );
    const worksheet = await readWorksheet(filePath);

    expect(worksheet.getRow(1).getCell(1).value).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
    expect(worksheet.getRow(1).getCell(1).font?.size).toBe(16);
    expect(String(worksheet.getRow(2).getCell(1).value)).toContain('UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026');
    expect(worksheet.getRow(2).getCell(1).font?.size).toBe(12);
    expect(worksheet.getRow(3).values.slice(1)).toEqual([
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
    ]);
    expect(worksheet.views?.[0]?.state).toBe('frozen');
    expect(worksheet.views?.[0]?.ySplit).toBe(3);
  });

  test('valores monetários no XLSX devem ser número com formato R$', async () => {
    const { createExcelWriterAdapter } = require('../src/adapters/excelWriterAdapter');
    const { buildUnimedSpreadsheet } = require('../src/modules/unimedSpreadsheetLayout');
    const filePath = path.join(outputDir, 'currency.xlsx');

    const sheet = buildUnimedSpreadsheet({
      text: '',
      rows: [
        {
          protocolo: '1',
          guia: '2',
          requisicao: '3',
          beneficiario: 'PACIENTE',
          dt_emis: '01/01/2026',
          medico: 'BOTO COR DE ROSA ALVES',
          codigo_procedimento: '50000470',
          qt: '1',
          vl_bruto: '45,54',
          vl_glosa: '0',
          vl_pago: '45,54',
        },
      ],
      metadata: {
        prestador: 'CONSULTORIO',
        paymentLine: 'UNIMED - TESTE',
      },
    });

    await createExcelWriterAdapter('exceljs').writeSheet(filePath, sheet.sheetRows);
    const worksheet = await readWorksheet(filePath);
    let dataRow = null;
    let resumoRateCell = null;

    worksheet.eachRow((row) => {
      if (row.getCell(4).value === 'PACIENTE') {
        dataRow = row;
      }
      if (row.getCell(9).value === 'VR.SESSÕES') {
        // header row of resumo — skip
      }
      const rateCell = row.getCell(9);
      if (typeof rateCell.value === 'number' && Math.abs(rateCell.value - 45.54) < 0.001) {
        resumoRateCell = rateCell;
      }
    });

    expect(dataRow).toBeTruthy();
    expect(typeof dataRow.getCell(9).value).toBe('number');
    expect(dataRow.getCell(9).value).toBeCloseTo(45.54);
    expect(dataRow.getCell(9).numFmt).toContain('R$');
    expect(typeof dataRow.getCell(11).value).toBe('number');
    expect(dataRow.getCell(11).value).toBeCloseTo(45.54);
    expect(dataRow.getCell(10).value).toBe('-');
    expect(typeof dataRow.getCell(8).value).toBe('number');
    expect(resumoRateCell).toBeTruthy();
    expect(resumoRateCell.numFmt).toContain('R$');
  });

  test('[F8-36] XLSX deve ter contorno e cabeçalhos 3px e itens da lista 1px', async () => {
    const { createExcelWriterAdapter } = require('../src/adapters/excelWriterAdapter');
    const { buildUnimedSpreadsheet } = require('../src/modules/unimedSpreadsheetLayout');
    const filePath = path.join(outputDir, 'borders.xlsx');

    const sheet = buildUnimedSpreadsheet({
      text: '',
      rows: [
        {
          protocolo: '1',
          guia: '2',
          requisicao: '3',
          beneficiario: 'PACIENTE',
          dt_emis: '01/01/2026',
          medico: 'BOTO COR DE ROSA ALVES',
          codigo_procedimento: '50000470',
          qt: '1',
          vl_bruto: '45,54',
          vl_glosa: '0',
          vl_pago: '45,54',
        },
      ],
      metadata: {
        prestador: 'CONSULTORIO',
        paymentLine: 'UNIMED - TESTE',
      },
    });

    await createExcelWriterAdapter('exceljs').writeSheet(filePath, sheet.sheetRows);
    const worksheet = await readWorksheet(filePath);
    const lastCol = 11;

    const preamble = worksheet.getRow(1).getCell(1);
    expect(rawBorderStyle(preamble, 'top')).toBe('thick');
    expect(borderStyle(preamble, 'top')).toBe('medium');
    expect(borderStyle(preamble, 'left')).toBe('medium');
    expect(borderStyle(preamble, 'bottom')).toBeUndefined();
    const secondPreamble = worksheet.getRow(2).getCell(1);
    expect(borderStyle(secondPreamble, 'top')).toBeUndefined();
    expect(borderStyle(secondPreamble, 'bottom')).toBe('medium');

    const columnHeader = worksheet.getRow(3).getCell(2);
    expect(rawBorderStyle(columnHeader, 'top')).toBe('thick');
    expect(borderStyle(columnHeader, 'top')).toBe('medium');
    expect(borderStyle(columnHeader, 'left')).toBe('medium');
    expect(borderStyle(columnHeader, 'right')).toBe('medium');
    expect(borderStyle(columnHeader, 'bottom')).toBe('medium');

    let dataRow = null;
    worksheet.eachRow((row) => {
      if (row.getCell(4).value === 'PACIENTE') {
        dataRow = row;
      }
    });
    expect(dataRow).toBeTruthy();
    expect(borderStyle(dataRow.getCell(4), 'top')).toBe('thin');
    expect(borderStyle(dataRow.getCell(4), 'right')).toBe('thin');
    expect(borderStyle(dataRow.getCell(1), 'left')).toBe('medium');

    expect(borderStyle(worksheet.getRow(1).getCell(lastCol), 'right')).toBe('medium');

    let subtotalRow = null;
    worksheet.eachRow((row) => {
      const label = String(row.getCell(1).value || '');
      if (label.startsWith('TOTAL - ')) {
        subtotalRow = row;
      }
    });
    expect(subtotalRow).toBeTruthy();
    expect(borderStyle(subtotalRow.getCell(1), 'top')).toBe('medium');
    expect(borderStyle(subtotalRow.getCell(1), 'bottom')).toBe('medium');
    expect(borderStyle(subtotalRow.getCell(1), 'left')).toBe('medium');
    expect(borderStyle(subtotalRow.getCell(lastCol), 'right')).toBe('medium');
    expect(subtotalRow.getCell(6).isMerged).toBe(true);
    expect(subtotalRow.getCell(6).master.address).toBe(`A${subtotalRow.number}`);
    expect(subtotalRow.height).toBe(22.5);
    expect(subtotalRow.font.bold).toBe(true);
    expect(subtotalRow.getCell(1).alignment.horizontal).toBe('right');
    expect(subtotalRow.getCell(1).alignment.indent).toBe(1);
    expect(borderStyle(subtotalRow.getCell(7), 'left')).toBe('thin');
    expect(borderStyle(subtotalRow.getCell(7), 'right')).toBe('thin');
    expect(borderStyle(subtotalRow.getCell(7), 'top')).toBe('medium');

    let grandTotalRow = null;
    worksheet.eachRow((row) => {
      if (
        String(row.getCell(1).value || '') === 'TOTAL GERAL'
        && row.getCell(1).font?.size === 13
      ) {
        grandTotalRow = row;
      }
    });
    expect(grandTotalRow).toBeTruthy();
    expect(borderStyle(grandTotalRow.getCell(1), 'top')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(1), 'bottom')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(1), 'left')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(lastCol), 'right')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(7), 'left')).toBe('thin');
    expect(borderStyle(grandTotalRow.getCell(7), 'right')).toBe('thin');
    expect(borderStyle(grandTotalRow.getCell(7), 'top')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(lastCol), 'bottom')).toBe('medium');
    expect(borderStyle(grandTotalRow.getCell(lastCol), 'right')).toBe('medium');
    expect(grandTotalRow.height).toBe(22.5);
    expect(grandTotalRow.font.bold).toBe(true);
    expect(grandTotalRow.font.size).toBe(13);
    expect(worksheet.getRow(grandTotalRow.number - 1).height).toBe(7.5);

    let resumoLabelRow = null;
    worksheet.eachRow((row) => {
      if (
        !resumoLabelRow
        && row.getCell(1).value === 'TOTAL GERAL'
        && row.getCell(1).font?.size === 12
      ) {
        resumoLabelRow = row;
      }
    });
    expect(resumoLabelRow).toBeTruthy();
    expect(resumoLabelRow.getCell(1).alignment?.textRotation).toBeUndefined();
    expect(borderStyle(resumoLabelRow.getCell(1), 'top')).toBe('medium');
    expect(borderStyle(resumoLabelRow.getCell(1), 'bottom')).toBe('medium');
    expect(borderStyle(resumoLabelRow.getCell(1), 'left')).toBe('medium');
    expect(borderStyle(resumoLabelRow.getCell(1), 'right')).toBe('medium');

    const separatorRow = worksheet.getRow(resumoLabelRow.number - 1);
    expect(borderStyle(separatorRow.getCell(1), 'top')).toBeUndefined();
    expect(borderStyle(separatorRow.getCell(1), 'bottom')).toBeUndefined();
    expect(borderStyle(separatorRow.getCell(1), 'left')).toBeUndefined();
    expect(borderStyle(separatorRow.getCell(1), 'right')).toBeUndefined();
    expect(borderStyle(separatorRow.getCell(6), 'left')).toBeUndefined();
    expect(borderStyle(separatorRow.getCell(11), 'right')).toBeUndefined();

    const nameCell = resumoLabelRow.getCell(6);
    expect(borderStyle(nameCell, 'top')).toBe('medium');
    expect(borderStyle(nameCell, 'left')).toBe('medium');
    expect(borderStyle(nameCell, 'right')).toBe('medium');

    const headerRate = resumoLabelRow.getCell(9);
    expect(headerRate.value).toBe('VR.SESSÕES');
    expect(borderStyle(headerRate, 'top')).toBe('medium');
    expect(borderStyle(headerRate, 'left')).toBe('medium');
    expect(borderStyle(resumoLabelRow.getCell(10), 'left')).toBe('thin');

    const firstDataRow = worksheet.getRow(resumoLabelRow.number + 1);
    expect(borderStyle(firstDataRow.getCell(9), 'top')).toBe('thin');
    expect(borderStyle(firstDataRow.getCell(9), 'left')).toBe('medium');
    expect(rawBorderStyle(firstDataRow.getCell(11), 'right')).toBe('thick');

    let resumoBlockTotal = null;
    worksheet.eachRow((row) => {
      if (String(row.getCell(9).value || '').startsWith('TOTAL - ')) {
        resumoBlockTotal = row;
      }
    });
    expect(resumoBlockTotal).toBeTruthy();
    expect(borderStyle(resumoBlockTotal.getCell(9), 'top')).toBe('medium');
    expect(borderStyle(resumoBlockTotal.getCell(9), 'bottom')).toBe('medium');
    expect(borderStyle(resumoBlockTotal.getCell(9), 'left')).toBe('medium');
    expect(borderStyle(resumoBlockTotal.getCell(10), 'left')).toBe('thin');
    expect(borderStyle(resumoBlockTotal.getCell(11), 'right')).toBe('medium');

    let resumoGrandTotal = null;
    worksheet.eachRow((row) => {
      if (row.getCell(9).value === 'TOTAL') {
        resumoGrandTotal = row;
      }
    });
    expect(resumoGrandTotal).toBeTruthy();
    expect(borderStyle(resumoGrandTotal.getCell(9), 'top')).toBe('medium');
    expect(borderStyle(resumoGrandTotal.getCell(9), 'bottom')).toBe('medium');
    expect(borderStyle(resumoGrandTotal.getCell(9), 'left')).toBe('medium');
    expect(borderStyle(resumoGrandTotal.getCell(10), 'left')).toBe('thin');
    expect(borderStyle(resumoGrandTotal.getCell(11), 'right')).toBe('medium');
  });

  test('[RED-26] cada linha exportada deve conter dados mapeados sem source_pdf', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath, rowCount } = await exportXlsx(
      [buildResult({ inputFile: 'unimed.pdf', text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );
    const worksheet = await readWorksheet(filePath);
    let ingridRow = null;

    worksheet.eachRow((row) => {
      if (row.getCell(4).value === 'HARPIA MAJESTOSA COELHO') {
        ingridRow = row.values.slice(1);
      }
    });

    expect(rowCount).toBe(4);
    expect(ingridRow[1]).toBe('7990003');
    expect(ingridRow[3]).toBe('HARPIA MAJESTOSA COELHO');
    expect(ingridRow[5]).toBe('BOTO COR DE ROSA ALVES');
    expect(ingridRow[6]).toBe('Consulta/Terapia');
    expect(ingridRow[7]).toBe(1);
  });

  test('[RED-27] o arquivo Excel gerado deve ser válido (parseável por exceljs)', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { fileName: 'export.xlsx' },
    );

    await expect(readWorksheet(filePath)).resolves.toBeDefined();
  });

  test('[RED-28] deve retornar o caminho absoluto do arquivo .xlsx gerado', async () => {
    const { filePath } = await exportXlsx([buildResult({ inputFile: 'relatorio.pdf' })], outputDir, {
      fallbackToRaw: true,
    });

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(path.basename(filePath)).toBe('relatorio_pdf.xlsx');
  });

  test('[RED-29] deve lançar ExportError se o array de entrada estiver vazio', async () => {
    await expect(exportXlsx([], outputDir)).rejects.toThrow(ExportError);
  });

  test('format legacy mantém colunas técnicas flat', async () => {
    const sampleText = await fs.readFile(UNIMED_SAMPLE_PATH, 'utf8');
    const { filePath } = await exportXlsx(
      [buildResult({ text: sampleText })],
      outputDir,
      { format: 'legacy', fileName: 'legacy.xlsx' },
    );
    const worksheet = await readWorksheet(filePath);
    const headerRow = worksheet.getRow(1).values.slice(1);

    expect(headerRow).toEqual([
      'source_pdf',
      'guia',
      'dt_emis',
      'beneficiario',
      'id_beneficiario',
      'pl',
      'medico',
      'requisicao',
      'codigo_procedimento',
      'procedimento',
      'qt',
    ]);
  });
});
