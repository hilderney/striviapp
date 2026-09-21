const fs = require('fs/promises');
const path = require('path');
const {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
} = require('pdf-lib');

const PAGE_MARGIN = 24;
const MAIN_COLUMN_WEIGHTS = [55, 50, 50, 120, 62, 120, 85, 35, 68, 60, 68];
const RESUMO_COLUMN_WEIGHTS = [240, 100, 70, 100];
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const HEADER_FILL = rgb(0.9, 0.93, 0.96);
const TOTAL_FILL = rgb(0.95, 0.95, 0.95);
const RESUMO_FILLS = [
  rgb(0.74, 0.84, 0.93),
  rgb(0.99, 0.89, 0.84),
  rgb(0.89, 0.94, 0.85),
  rgb(0.95, 0.95, 0.95),
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fitText(text, font, size, maxWidth) {
  const normalized = normalizeText(text);
  if (!normalized || font.widthOfTextAtSize(normalized, size) <= maxWidth) {
    return normalized;
  }

  let shortened = normalized;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

function scaleWidths(weights, availableWidth) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => (value / total) * availableWidth);
}

function resumoCells(sheetRow) {
  if (['resumo-executante-start', 'resumo-grand-start'].includes(sheetRow.type)) {
    return sheetRow.cells;
  }
  return ['', ...(sheetRow.cells || [])];
}

class PdfWriterAdapter {
  async writeSheet(filePath, sheetRows) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const document = await PDFDocument.create();
    const regularFont = await document.embedFont(StandardFonts.Helvetica);
    const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
    document.setCreator('striviapp');
    document.setTitle('Relatório Unimed');

    const landscapeA4 = [PageSizes.A4[1], PageSizes.A4[0]];
    let page;
    let cursorY;
    let resumoColorIndex = 0;

    const addPage = () => {
      page = document.addPage(landscapeA4);
      cursorY = page.getHeight() - PAGE_MARGIN;
    };

    const ensureSpace = (height) => {
      if (!page || cursorY - height < PAGE_MARGIN) {
        addPage();
      }
    };

    const drawFullWidthText = (text, {
      size = 12,
      height = 24,
      bold = false,
      borderWidth = 0,
      fill = WHITE,
    } = {}) => {
      ensureSpace(height);
      const width = page.getWidth() - PAGE_MARGIN * 2;
      const y = cursorY - height;
      if (borderWidth > 0) {
        page.drawRectangle({
          x: PAGE_MARGIN,
          y,
          width,
          height,
          color: fill,
          borderColor: BLACK,
          borderWidth,
        });
      }
      const font = bold ? boldFont : regularFont;
      page.drawText(fitText(text, font, size, width - 12), {
        x: PAGE_MARGIN + 6,
        y: y + (height - size) / 2,
        size,
        font,
        color: BLACK,
      });
      cursorY = y;
    };

    const drawTableRow = (
      cells,
      {
        weights = MAIN_COLUMN_WEIGHTS,
        height = 20,
        bold = false,
        borderWidth = 1,
        fill = WHITE,
      } = {},
    ) => {
      ensureSpace(height);
      const availableWidth = page.getWidth() - PAGE_MARGIN * 2;
      const widths = scaleWidths(weights, availableWidth);
      const y = cursorY - height;
      const font = bold ? boldFont : regularFont;
      const fontSize = weights === MAIN_COLUMN_WEIGHTS ? 7 : 8;
      let x = PAGE_MARGIN;

      widths.forEach((width, index) => {
        page.drawRectangle({
          x,
          y,
          width,
          height,
          color: fill,
          borderColor: BLACK,
          borderWidth,
        });
        page.drawText(fitText(cells[index], font, fontSize, width - 6), {
          x: x + 3,
          y: y + (height - fontSize) / 2,
          size: fontSize,
          font,
          color: BLACK,
        });
        x += width;
      });
      cursorY = y;
    };

    addPage();
    for (const sheetRow of sheetRows) {
      switch (sheetRow.type) {
        case 'preamble': {
          const isTitle = sheetRow.meta?.style === 'header1';
          drawFullWidthText(sheetRow.cells?.[0], {
            size: isTitle ? 16 : 12,
            height: isTitle ? 30 : 24,
            bold: true,
            borderWidth: 2,
          });
          break;
        }
        case 'header':
          drawTableRow(sheetRow.cells, {
            bold: true,
            height: 24,
            borderWidth: 2,
            fill: HEADER_FILL,
          });
          break;
        case 'subtotal':
        case 'grand-total':
          drawTableRow(sheetRow.cells, {
            bold: true,
            height: 22,
            borderWidth: 2,
            fill: TOTAL_FILL,
          });
          break;
        case 'data':
          drawTableRow(sheetRow.cells);
          break;
        case 'blank':
          ensureSpace(12);
          cursorY -= 12;
          break;
        case 'resumo-separator':
          ensureSpace(30);
          cursorY -= 10;
          drawFullWidthText('RESUMO GERAL', { size: 13, height: 24, bold: true });
          break;
        case 'resumo-executante-start':
        case 'resumo-grand-start': {
          const isGrand = sheetRow.type === 'resumo-grand-start';
          const fill = isGrand
            ? RESUMO_FILLS[RESUMO_FILLS.length - 1]
            : RESUMO_FILLS[resumoColorIndex % (RESUMO_FILLS.length - 1)];
          if (!isGrand) resumoColorIndex += 1;
          drawTableRow(resumoCells(sheetRow), {
            weights: RESUMO_COLUMN_WEIGHTS,
            bold: true,
            height: 24,
            borderWidth: 2,
            fill,
          });
          break;
        }
        case 'resumo-subtotal':
        case 'resumo-grand-total':
          drawTableRow(resumoCells(sheetRow), {
            weights: RESUMO_COLUMN_WEIGHTS,
            bold: true,
            height: 22,
            borderWidth: 2,
            fill: TOTAL_FILL,
          });
          break;
        case 'resumo-data':
          drawTableRow(resumoCells(sheetRow), {
            weights: RESUMO_COLUMN_WEIGHTS,
            height: 20,
          });
          break;
        default:
          drawTableRow(sheetRow.cells || []);
      }
    }

    const bytes = await document.save();
    await fs.writeFile(filePath, bytes);
  }
}

function createPdfWriterAdapter(type = 'pdf-lib') {
  if (type !== 'pdf-lib') {
    throw new Error(`Unknown PDF writer adapter: ${type}`);
  }
  return new PdfWriterAdapter();
}

module.exports = {
  PdfWriterAdapter,
  createPdfWriterAdapter,
};
