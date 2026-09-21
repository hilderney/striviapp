const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { COLUMN_COUNT, SUBTOTAL_LABEL_COLSPAN } = require('../modules/unimedSpreadsheetLayout');
const {
  RESUMO_LEFT_COLSPAN,
  RESUMO_NAME_COLSPAN,
} = require('../modules/unimedResumoGeral');
const { parseBrazilianMoney } = require('../modules/unimedMoney');

const WORKBOOK_CREATOR = 'striviapp';
const DEFAULT_SHEET_NAME = 'documents';

const BRL_NUM_FMT = '"R$"#,##0.00';
const DASH_PLACEHOLDER = '-';

const QT_COL = 8;
const MONEY_COLS = [9, 10, 11];

const RESUMO_NAME_COL = RESUMO_LEFT_COLSPAN + 1;
const RESUMO_DATA_COL = RESUMO_NAME_COL + RESUMO_NAME_COLSPAN;
const RESUMO_QUANTITY_COL = RESUMO_DATA_COL + 1;
const RESUMO_TOTAL_COL = RESUMO_DATA_COL + 2;

const PREAMBLE_FONT_SIZE = { header1: 16, header3: 12 };
const RESUMO_BLOCK_COLORS = ['FFBDD7EE', 'FFFCE4D6', 'FFE2EFDA', 'FFF2F2F2'];
const RESUMO_GRAND_COLOR_INDEX = 3;

const FROZEN_HEADER_ROWS = 3;
const COLUMN_WIDTHS = [14, 12, 12, 28, 14, 28, 16, 8, 14, 12, 14];
const NORMAL_ROW_HEIGHT = 15;
const SUMMARY_ROW_HEIGHT = NORMAL_ROW_HEIGHT * 1.5;
const SUMMARY_SEPARATOR_ROW_HEIGHT = NORMAL_ROW_HEIGHT * 0.5;
const NORMAL_FONT_SIZE = 11;
const GRAND_TOTAL_FONT_SIZE = Math.round(NORMAL_FONT_SIZE * 1.2);

const BORDER_BLACK = { argb: 'FF000000' };
const BORDER_3PX = { style: 'thick', color: BORDER_BLACK };
const BORDER_1PX = { style: 'thin', color: BORDER_BLACK };

function boxBorder(edge) {
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function setBorderSides(cell, sides) {
  cell.border = { ...(cell.border || {}), ...sides };
}

class ExcelWriterAdapter {
  async write(_filePath, _rows, _headers) {
    throw new Error('ExcelWriterAdapter.write() must be implemented');
  }
}

function emptyCells(count) {
  return new Array(count).fill('');
}

function isBlankValue(value) {
  return value === null || value === undefined || value === '';
}

function setCurrencyCell(cell, rawValue) {
  if (isBlankValue(rawValue) || rawValue === DASH_PLACEHOLDER) {
    cell.value = rawValue === DASH_PLACEHOLDER ? DASH_PLACEHOLDER : null;
    return;
  }

  cell.value =
    typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? rawValue
      : parseBrazilianMoney(rawValue);
  cell.numFmt = BRL_NUM_FMT;
}

function setIntegerCell(cell, rawValue) {
  if (isBlankValue(rawValue)) {
    cell.value = null;
    return;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  cell.value = Number.isFinite(parsed) ? parsed : rawValue;
}

function markBold(cell) {
  cell.font = { bold: true };
}

function markTopBorder(cell) {
  cell.border = { top: BORDER_3PX };
}

/**
 * Renders the Unimed report layout (preamble, grouped table and RESUMO GERAL)
 * into a single ExcelJS worksheet. Row-type handling is split into small
 * methods so the layout rules stay readable and easy to change.
 */
class UnimedReportRenderer {
  constructor(worksheet) {
    this.worksheet = worksheet;
    this.rowIndex = 0;
    this.preambleIndex = 0;
    this.resumoSectionStart = null;
    this.resumoSectionEnd = null;
    this.resumoBlockStartRow = null;
    this.resumoBlockColorIndex = 0;
    this.preambleRowIndexes = [];
    this.columnHeaderRowIndexes = [];
    this.listItemRowIndexes = [];
    this.listTotalRowIndexes = [];
    this.resumoSeparatorRowIndexes = [];
    this.resumoBlocks = [];
    this.currentResumoBlock = null;
  }

  render(sheetRows) {
    for (const sheetRow of sheetRows) {
      this.rowIndex += 1;
      this.renderRow(sheetRow);
    }

    this.mergeResumoLabel();
    this.applyBorders();
    this.freezeHeader();
    this.applyColumnWidths();
  }

  renderRow(sheetRow) {
    switch (sheetRow.type) {
      case 'preamble':
        return this.renderPreamble(sheetRow);
      case 'blank':
        return this.renderBlank();
      case 'resumo-separator':
      case 'resumo-blank':
        return this.renderResumoSeparator();
      case 'resumo-executante-start':
      case 'resumo-grand-start':
        return this.renderResumoBlockStart(sheetRow);
      case 'resumo-data':
        return this.renderResumoData(sheetRow);
      case 'resumo-subtotal':
      case 'resumo-grand-total':
        return this.renderResumoTotal(sheetRow);
      default:
        return this.renderTableRow(sheetRow);
    }
  }

  addRow(cells) {
    return this.worksheet.addRow(cells);
  }

  buildResumoRow(nameValue, dataValues = []) {
    const cells = emptyCells(COLUMN_COUNT);
    if (nameValue != null) {
      cells[RESUMO_NAME_COL - 1] = nameValue;
    }
    dataValues.forEach((value, offset) => {
      cells[RESUMO_DATA_COL - 1 + offset] = value;
    });
    return cells;
  }

  renderPreamble(sheetRow) {
    const row = this.addRow([sheetRow.cells[0], ...emptyCells(COLUMN_COUNT - 1)]);
    this.worksheet.mergeCells(this.rowIndex, 1, this.rowIndex, COLUMN_COUNT);

    const style = sheetRow.meta?.style || (this.preambleIndex === 0 ? 'header1' : 'header3');
    const cell = row.getCell(1);
    cell.font = { bold: true, size: PREAMBLE_FONT_SIZE[style] ?? PREAMBLE_FONT_SIZE.header3 };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    this.preambleIndex += 1;
    this.preambleRowIndexes.push(this.rowIndex);
  }

  renderBlank() {
    const row = this.addRow(emptyCells(COLUMN_COUNT));
    row.height = SUMMARY_SEPARATOR_ROW_HEIGHT;
  }

  renderResumoSeparator() {
    this.addRow(emptyCells(COLUMN_COUNT));
    this.resumoSeparatorRowIndexes.push(this.rowIndex);
  }

  renderResumoBlank() {
    this.renderResumoSeparator();
  }

  renderResumoBlockStart(sheetRow) {
    this.openResumoSection();
    this.resumoBlockStartRow = this.rowIndex;

    const [nameValue, ...headers] = sheetRow.cells;
    const row = this.addRow(this.buildResumoRow(nameValue, headers));

    const isGrandTotal = sheetRow.type === 'resumo-grand-start';
    const colorIndex = isGrandTotal ? RESUMO_GRAND_COLOR_INDEX : this.resumoBlockColorIndex;
    this.styleResumoBlockLabel(row.getCell(RESUMO_NAME_COL), colorIndex);

    [RESUMO_DATA_COL, RESUMO_QUANTITY_COL, RESUMO_TOTAL_COL].forEach((col) => markBold(row.getCell(col)));

    if (!isGrandTotal) {
      this.resumoBlockColorIndex += 1;
    }

    this.currentResumoBlock = {
      startRow: this.rowIndex,
      headerRow: this.rowIndex,
      dataRows: [],
      totalRow: null,
      endRow: this.rowIndex,
    };
  }

  renderResumoData(sheetRow) {
    const row = this.addRow(this.buildResumoRow(null, sheetRow.cells));
    setCurrencyCell(row.getCell(RESUMO_DATA_COL), row.getCell(RESUMO_DATA_COL).value);
    setIntegerCell(row.getCell(RESUMO_QUANTITY_COL), row.getCell(RESUMO_QUANTITY_COL).value);
    setCurrencyCell(row.getCell(RESUMO_TOTAL_COL), row.getCell(RESUMO_TOTAL_COL).value);
    if (this.currentResumoBlock) {
      this.currentResumoBlock.dataRows.push(this.rowIndex);
      this.currentResumoBlock.endRow = this.rowIndex;
    }
  }

  renderResumoTotal(sheetRow) {
    const row = this.addRow(this.buildResumoRow(null, sheetRow.cells));
    row.font = { bold: true };
    [RESUMO_DATA_COL, RESUMO_QUANTITY_COL, RESUMO_TOTAL_COL].forEach((col) => markTopBorder(row.getCell(col)));

    setIntegerCell(row.getCell(RESUMO_QUANTITY_COL), row.getCell(RESUMO_QUANTITY_COL).value);
    setCurrencyCell(row.getCell(RESUMO_TOTAL_COL), row.getCell(RESUMO_TOTAL_COL).value);

    this.closeResumoBlock();

    if (this.currentResumoBlock) {
      this.currentResumoBlock.totalRow = this.rowIndex;
      this.currentResumoBlock.endRow = this.rowIndex;
      this.resumoBlocks.push(this.currentResumoBlock);
      this.currentResumoBlock = null;
    }

    if (sheetRow.type === 'resumo-grand-total') {
      this.resumoSectionEnd = this.rowIndex;
    }
  }

  renderTableRow(sheetRow) {
    const row = this.addRow(sheetRow.cells);

    if (sheetRow.type === 'header') {
      row.font = { bold: true };
      this.columnHeaderRowIndexes.push(this.rowIndex);
    }

    if (sheetRow.type === 'data') {
      this.listItemRowIndexes.push(this.rowIndex);
    }

    if (['subtotal', 'grand-total'].includes(sheetRow.type)) {
      this.listTotalRowIndexes.push(this.rowIndex);
    }

    if (['data', 'subtotal', 'grand-total'].includes(sheetRow.type)) {
      this.applyTableMoneyFormats(row);
    }

    if (['subtotal', 'grand-total'].includes(sheetRow.type)) {
      row.font = { bold: true };
      row.height = SUMMARY_ROW_HEIGHT;
      const labelColspan = sheetRow.meta?.labelColspan || SUBTOTAL_LABEL_COLSPAN;
      this.worksheet.mergeCells(this.rowIndex, 1, this.rowIndex, labelColspan);

      if (sheetRow.type === 'subtotal') {
        row.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      }

      if (sheetRow.type === 'grand-total') {
        row.font = { bold: true, size: GRAND_TOTAL_FONT_SIZE };
      }
    }
  }

  applyTableMoneyFormats(row) {
    setIntegerCell(row.getCell(QT_COL), row.getCell(QT_COL).value);
    for (const col of MONEY_COLS) {
      setCurrencyCell(row.getCell(col), row.getCell(col).value);
    }
  }

  styleResumoBlockLabel(cell, colorIndex) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: RESUMO_BLOCK_COLORS[colorIndex % RESUMO_BLOCK_COLORS.length] },
    };
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }

  openResumoSection() {
    if (!this.resumoSectionStart) {
      this.resumoSectionStart = this.rowIndex;
    }
  }

  closeResumoBlock() {
    if (!this.resumoBlockStartRow) {
      return;
    }
    this.worksheet.mergeCells(
      this.resumoBlockStartRow,
      RESUMO_NAME_COL,
      this.rowIndex,
      RESUMO_NAME_COL + RESUMO_NAME_COLSPAN - 1,
    );
    this.resumoBlockStartRow = null;
  }

  mergeResumoLabel() {
    const { resumoSectionStart, resumoSectionEnd } = this;
    if (!resumoSectionStart || !resumoSectionEnd || resumoSectionEnd < resumoSectionStart) {
      return;
    }

    this.worksheet.mergeCells(resumoSectionStart, 1, resumoSectionEnd, RESUMO_LEFT_COLSPAN);
    const label = this.worksheet.getCell(resumoSectionStart, 1);
    label.value = 'TOTAL GERAL';
    label.font = { bold: true, size: 12 };
    label.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  freezeHeader() {
    this.worksheet.views = [{ state: 'frozen', ySplit: FROZEN_HEADER_ROWS, activeCell: 'A4' }];
  }

  applyColumnWidths() {
    this.worksheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));
  }

  applyBorders() {
    const lastRow = this.rowIndex;
    if (lastRow < 1) {
      return;
    }

    this.applyPreambleOutline(BORDER_3PX);

    for (const rowIndex of this.columnHeaderRowIndexes) {
      this.applyRowCellBoxes(rowIndex, BORDER_3PX);
    }

    for (const rowIndex of this.listItemRowIndexes) {
      this.applyRowCellBoxes(rowIndex, BORDER_1PX);
    }

    for (const rowIndex of this.listTotalRowIndexes) {
      this.applyRowCellBoxes(rowIndex, BORDER_1PX);
      this.applyMergedRowOutline(rowIndex, BORDER_3PX);
    }

    const listEndRow =
      this.listTotalRowIndexes.length > 0
        ? this.listTotalRowIndexes[this.listTotalRowIndexes.length - 1]
        : lastRow;
    this.applyDocumentOutline(listEndRow, BORDER_3PX);

    for (const rowIndex of this.resumoSeparatorRowIndexes) {
      this.clearRowBorders(rowIndex);
    }

    this.applyResumoBorders();
  }

  applyMergedRowOutline(rowIndex, edge) {
    for (let col = 1; col <= COLUMN_COUNT; col += 1) {
      const sides = { top: edge, bottom: edge };
      if (col === 1) {
        sides.left = edge;
      }
      if (col === COLUMN_COUNT) {
        sides.right = edge;
      }
      setBorderSides(this.worksheet.getCell(rowIndex, col), sides);
    }
  }

  applyPreambleOutline(edge) {
    const firstRow = this.preambleRowIndexes[0];
    const lastRow = this.preambleRowIndexes[this.preambleRowIndexes.length - 1];
    if (!firstRow || !lastRow) {
      return;
    }

    for (const rowIndex of this.preambleRowIndexes) {
      for (let col = 1; col <= COLUMN_COUNT; col += 1) {
        const sides = {};
        if (rowIndex === firstRow) {
          sides.top = edge;
        }
        if (rowIndex === lastRow) {
          sides.bottom = edge;
        }
        if (col === 1) {
          sides.left = edge;
        }
        if (col === COLUMN_COUNT) {
          sides.right = edge;
        }
        setBorderSides(this.worksheet.getCell(rowIndex, col), sides);
      }
    }
  }

  applyRowCellBoxes(rowIndex, edge) {
    const box = boxBorder(edge);
    for (let col = 1; col <= COLUMN_COUNT; col += 1) {
      setBorderSides(this.worksheet.getCell(rowIndex, col), box);
    }
  }

  applyDocumentOutline(lastRow, edge) {
    for (let row = 1; row <= lastRow; row += 1) {
      for (let col = 1; col <= COLUMN_COUNT; col += 1) {
        const sides = {};
        if (row === 1) {
          sides.top = edge;
        }
        if (row === lastRow) {
          sides.bottom = edge;
        }
        if (col === 1) {
          sides.left = edge;
        }
        if (col === COLUMN_COUNT) {
          sides.right = edge;
        }
        if (Object.keys(sides).length > 0) {
          setBorderSides(this.worksheet.getCell(row, col), sides);
        }
      }
    }
  }

  clearRowBorders(rowIndex) {
    for (let col = 1; col <= COLUMN_COUNT; col += 1) {
      this.worksheet.getCell(rowIndex, col).border = {};
    }
  }

  applyColRangeBoxes(rowIndex, startCol, endCol, edge) {
    const box = boxBorder(edge);
    for (let col = startCol; col <= endCol; col += 1) {
      setBorderSides(this.worksheet.getCell(rowIndex, col), box);
    }
  }

  applyColRangeOutline(rowIndex, startCol, endCol, edge) {
    for (let col = startCol; col <= endCol; col += 1) {
      const sides = { top: edge, bottom: edge };
      if (col === startCol) {
        sides.left = edge;
      }
      if (col === endCol) {
        sides.right = edge;
      }
      setBorderSides(this.worksheet.getCell(rowIndex, col), sides);
    }
  }

  applyRectOutline(startRow, startCol, endRow, endCol, edge) {
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const sides = {};
        if (row === startRow) {
          sides.top = edge;
        }
        if (row === endRow) {
          sides.bottom = edge;
        }
        if (col === startCol) {
          sides.left = edge;
        }
        if (col === endCol) {
          sides.right = edge;
        }
        if (Object.keys(sides).length > 0) {
          setBorderSides(this.worksheet.getCell(row, col), sides);
        }
      }
    }
  }

  applyResumoBorders() {
    const { resumoSectionStart, resumoSectionEnd } = this;
    if (!resumoSectionStart || !resumoSectionEnd || resumoSectionEnd < resumoSectionStart) {
      return;
    }

    this.applyRectOutline(resumoSectionStart, 1, resumoSectionEnd, RESUMO_LEFT_COLSPAN, BORDER_3PX);
    setBorderSides(this.worksheet.getCell(resumoSectionStart, 1), boxBorder(BORDER_3PX));

    const nameEndCol = RESUMO_NAME_COL + RESUMO_NAME_COLSPAN - 1;
    const dataStart = RESUMO_DATA_COL;
    const dataEnd = RESUMO_TOTAL_COL;

    for (const block of this.resumoBlocks) {
      this.applyRectOutline(block.startRow, RESUMO_NAME_COL, block.endRow, nameEndCol, BORDER_3PX);
      setBorderSides(this.worksheet.getCell(block.startRow, RESUMO_NAME_COL), boxBorder(BORDER_3PX));

      const dataRows = [block.headerRow, ...block.dataRows];
      if (block.totalRow) {
        dataRows.push(block.totalRow);
      }
      for (const rowIndex of dataRows) {
        this.applyColRangeBoxes(rowIndex, dataStart, dataEnd, BORDER_1PX);
      }

      this.applyRectOutline(block.startRow, dataStart, block.endRow, dataEnd, BORDER_3PX);
      if (block.totalRow) {
        this.applyColRangeOutline(block.totalRow, dataStart, dataEnd, BORDER_3PX);
      }
    }
  }
}

class ExcelJsAdapter extends ExcelWriterAdapter {
  async write(filePath, rows, headers) {
    const worksheet = await this.createWorksheet(filePath, DEFAULT_SHEET_NAME);

    worksheet.columns = headers.map((header) => ({
      header: header.title,
      key: header.id,
      width: header.id === 'content' ? 60 : 24,
    }));

    for (const row of rows) {
      worksheet.addRow(row);
    }

    worksheet.getRow(1).font = { bold: true };
    await worksheet.workbook.xlsx.writeFile(filePath);
  }

  async writeSheet(filePath, sheetRows, options = {}) {
    const worksheet = await this.createWorksheet(filePath, options.sheetName || DEFAULT_SHEET_NAME);
    new UnimedReportRenderer(worksheet).render(sheetRows);
    await worksheet.workbook.xlsx.writeFile(filePath);
  }

  async createWorksheet(filePath, sheetName) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = WORKBOOK_CREATOR;
    workbook.created = new Date();

    return workbook.addWorksheet(sheetName);
  }
}

function createExcelWriterAdapter(type = 'exceljs') {
  switch (type) {
    case 'exceljs':
      return new ExcelJsAdapter();
    default:
      throw new Error(`Unknown Excel writer adapter: ${type}`);
  }
}

module.exports = {
  ExcelWriterAdapter,
  ExcelJsAdapter,
  createExcelWriterAdapter,
};
