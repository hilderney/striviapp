const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, PageSizes, StandardFonts, rgb } = require('pdf-lib');

const PAGE_MARGIN = 12;
const MAIN_COLUMN_WEIGHTS = [55, 50, 50, 120, 62, 120, 85, 35, 68, 60, 68];
const RESUMO_LAYOUT_WEIGHTS = [80, 52, 14, 12, 16];
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const HEADER_FILL = rgb(0.9, 0.93, 0.96);
const TOTAL_FILL = rgb(0.95, 0.95, 0.95);
const RESUMO_FILLS = [
  rgb(0.74, 0.84, 0.93),
  rgb(0.99, 0.89, 0.84),
  rgb(0.89, 0.94, 0.85),
  TOTAL_FILL,
];

const THIN_BORDER = 1;
const THICK_BORDER = 3;
const MAIN_ROW_HEIGHT = 16;
const SUMMARY_ROW_HEIGHT = MAIN_ROW_HEIGHT * 1.5;
const SUMMARY_SEPARATOR_HEIGHT = MAIN_ROW_HEIGHT * 0.5;
const RESUMO_HEADER_HEIGHT = MAIN_ROW_HEIGHT;
const MAIN_FONT_SIZE = 6;
const RESUMO_FONT_SIZE = 6;

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

function summaryBlockHeight(block) {
  return RESUMO_HEADER_HEIGHT + block.data.length * MAIN_ROW_HEIGHT + SUMMARY_ROW_HEIGHT;
}

function buildResumoBlocks(sheetRows) {
  const blocks = [];
  let current = null;

  for (const sheetRow of sheetRows) {
    if (['resumo-executante-start', 'resumo-grand-start'].includes(sheetRow.type)) {
      current = {
        label: sheetRow.cells[0],
        headers: sheetRow.cells.slice(1),
        data: [],
        total: null,
        isGrand: sheetRow.type === 'resumo-grand-start',
      };
      continue;
    }

    if (sheetRow.type === 'resumo-data' && current) {
      current.data.push(sheetRow.cells);
      continue;
    }

    if (['resumo-subtotal', 'resumo-grand-total'].includes(sheetRow.type) && current) {
      current.total = sheetRow.cells;
      blocks.push(current);
      current = null;
    }
  }

  return blocks;
}

class PdfWriterAdapter {
  async writeSheet(filePath, sheetRows) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const document = await PDFDocument.create();
    const regularFont = await document.embedFont(StandardFonts.Helvetica);
    const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
    document.setCreator('striviapp');
    document.setTitle('Relatório Unimed');

    const portraitA4 = PageSizes.A4;
    let page;
    let cursorY;

    const addPage = () => {
      page = document.addPage(portraitA4);
      cursorY = page.getHeight() - PAGE_MARGIN;
    };

    const ensureSpace = (height) => {
      if (!page || cursorY - height < PAGE_MARGIN) {
        addPage();
      }
    };

    const drawText = (text, {
      x,
      y,
      width,
      height,
      size,
      bold = false,
      align = 'left',
    }) => {
      const font = bold ? boldFont : regularFont;
      const value = fitText(text, font, size, Math.max(width - 6, 1));
      const textWidth = font.widthOfTextAtSize(value, size);
      const textX =
        align === 'center'
          ? x + (width - textWidth) / 2
          : align === 'right'
            ? x + width - textWidth - 3
            : x + 3;
      page.drawText(value, {
        x: Math.max(x + 3, textX),
        y: y + (height - size) / 2,
        size,
        font,
        color: BLACK,
      });
    };

    const drawRow = (
      cells,
      {
        weights = MAIN_COLUMN_WEIGHTS,
        height = MAIN_ROW_HEIGHT,
        bold = false,
        borderWidth = THIN_BORDER,
        outerBorderWidth = 0,
        outerVerticalBorderWidth = 0,
        fill = WHITE,
        spans = [],
        alignments = {},
        fontSize = weights === MAIN_COLUMN_WEIGHTS ? MAIN_FONT_SIZE : RESUMO_FONT_SIZE,
      } = {},
    ) => {
      ensureSpace(height);
      const availableWidth = page.getWidth() - PAGE_MARGIN * 2;
      const widths = scaleWidths(weights, availableWidth);
      const y = cursorY - height;
      const spanEnds = new Map(spans.map(({ start, end }) => [start, end]));
      let x = PAGE_MARGIN;

      for (let index = 0; index < widths.length; ) {
        const end = spanEnds.get(index) ?? index;
        const width = widths.slice(index, end + 1).reduce((sum, value) => sum + value, 0);
        page.drawRectangle({
          x,
          y,
          width,
          height,
          color: fill,
          borderColor: BLACK,
          borderWidth,
        });
        drawText(cells[index], {
          x,
          y,
          width,
          height,
          size: fontSize,
          bold,
          align: alignments[index] || 'left',
        });
        x += width;
        index = end + 1;
      }

      if (outerBorderWidth > 0) {
        page.drawRectangle({
          x: PAGE_MARGIN,
          y,
          width: availableWidth,
          height,
          borderColor: BLACK,
          borderWidth: outerBorderWidth,
        });
      }
      if (outerVerticalBorderWidth > 0) {
        page.drawLine({
          start: { x: PAGE_MARGIN, y },
          end: { x: PAGE_MARGIN, y: y + height },
          color: BLACK,
          thickness: outerVerticalBorderWidth,
        });
        page.drawLine({
          start: { x: PAGE_MARGIN + availableWidth, y },
          end: { x: PAGE_MARGIN + availableWidth, y: y + height },
          color: BLACK,
          thickness: outerVerticalBorderWidth,
        });
      }

      cursorY = y;
    };

    const drawPreamble = (rows) => {
      const heights = rows.map((row, index) => (index === 0 ? 30 : 20));
      const height = heights.reduce((sum, value) => sum + value, 0);
      ensureSpace(height);
      const width = page.getWidth() - PAGE_MARGIN * 2;
      const y = cursorY - height;
      page.drawRectangle({
        x: PAGE_MARGIN,
        y,
        width,
        height,
        color: WHITE,
        borderColor: BLACK,
        borderWidth: THICK_BORDER,
      });

      let rowY = cursorY;
      rows.forEach((row, index) => {
        rowY -= heights[index];
        drawText(row.cells?.[0], {
          x: PAGE_MARGIN,
          y: rowY,
          width,
          height: heights[index],
          size: row.meta?.style === 'header1' ? 16 : 12,
          bold: true,
        });
      });
      cursorY = y;
    };

    const drawResumoChunk = (blocks) => {
      const heights = blocks.map(summaryBlockHeight);
      const totalHeight =
        heights.reduce((sum, value) => sum + value, 0) +
        Math.max(0, blocks.length - 1) * SUMMARY_SEPARATOR_HEIGHT;
      ensureSpace(totalHeight);

      const availableWidth = page.getWidth() - PAGE_MARGIN * 2;
      const layoutWidths = scaleWidths(RESUMO_LAYOUT_WEIGHTS, availableWidth);
      const leftWidth = layoutWidths[0];
      const nameWidth = layoutWidths[1];
      const dataWidths = layoutWidths.slice(2);
      const rightX = PAGE_MARGIN + leftWidth;
      const dataX = rightX + nameWidth;
      const sectionY = cursorY - totalHeight;

      page.drawRectangle({
        x: PAGE_MARGIN,
        y: sectionY,
        width: leftWidth,
        height: totalHeight,
        color: WHITE,
        borderColor: BLACK,
        borderWidth: THICK_BORDER,
      });
      drawText('TOTAL GERAL', {
        x: PAGE_MARGIN,
        y: sectionY,
        width: leftWidth,
        height: totalHeight,
        size: 12,
        bold: true,
        align: 'center',
      });

      blocks.forEach((block, index) => {
        const blockHeight = heights[index];
        const blockY = cursorY - blockHeight;
        const fill = block.isGrand
          ? RESUMO_FILLS[RESUMO_FILLS.length - 1]
          : RESUMO_FILLS[index % (RESUMO_FILLS.length - 1)];

        page.drawRectangle({
          x: rightX,
          y: blockY,
          width: nameWidth,
          height: blockHeight,
          color: fill,
          borderColor: BLACK,
          borderWidth: THICK_BORDER,
        });
        drawText(block.label, {
          x: rightX,
          y: blockY,
          width: nameWidth,
          height: blockHeight,
          size: 8,
          bold: true,
          align: 'center',
        });

        let dataY = cursorY;
        const drawResumoValueRow = (cells, height, bold) => {
          dataY -= height;
          let x = dataX;
          dataWidths.forEach((width, cellIndex) => {
            page.drawRectangle({
              x,
              y: dataY,
              width,
              height,
              color: WHITE,
              borderColor: BLACK,
              borderWidth: THIN_BORDER,
            });
            drawText(cells[cellIndex], {
              x,
              y: dataY,
              width,
              height,
              size: RESUMO_FONT_SIZE,
              bold,
              align: cellIndex === 0 ? 'left' : 'right',
            });
            x += width;
          });
        };

        drawResumoValueRow(block.headers, RESUMO_HEADER_HEIGHT, true);
        block.data.forEach((row) => drawResumoValueRow(row, MAIN_ROW_HEIGHT, false));
        drawResumoValueRow(block.total || [], SUMMARY_ROW_HEIGHT, true);
        page.drawRectangle({
          x: dataX,
          y: blockY,
          width: dataWidths.reduce((sum, value) => sum + value, 0),
          height: blockHeight,
          borderColor: BLACK,
          borderWidth: THICK_BORDER,
        });

        cursorY = blockY;
        if (index < blocks.length - 1) {
          cursorY -= SUMMARY_SEPARATOR_HEIGHT;
        }
      });
    };

    const drawResumo = (resumoRows) => {
      const blocks = buildResumoBlocks(resumoRows);
      const maxHeight = portraitA4[1] - PAGE_MARGIN * 2;
      let chunk = [];
      let chunkHeight = 0;

      for (const block of blocks) {
        const nextHeight = summaryBlockHeight(block) + (chunk.length > 0 ? SUMMARY_SEPARATOR_HEIGHT : 0);
        if (chunk.length > 0 && chunkHeight + nextHeight > maxHeight) {
          drawResumoChunk(chunk);
          chunk = [];
          chunkHeight = 0;
        }
        chunk.push(block);
        chunkHeight += nextHeight;
      }
      if (chunk.length > 0) {
        drawResumoChunk(chunk);
      }
    };

    const mainRows = [];
    const resumoRows = [];
    let inResumo = false;
    for (const sheetRow of sheetRows) {
      if (
        inResumo ||
        ['resumo-separator', 'resumo-blank', 'resumo-executante-start', 'resumo-grand-start', 'resumo-data', 'resumo-subtotal', 'resumo-grand-total'].includes(
          sheetRow.type,
        )
      ) {
        inResumo = true;
        resumoRows.push(sheetRow);
      } else {
        mainRows.push(sheetRow);
      }
    }

    addPage();
    for (let index = 0; index < mainRows.length; ) {
      const sheetRow = mainRows[index];
      if (sheetRow.type === 'preamble') {
        const preambles = [];
        while (mainRows[index]?.type === 'preamble') {
          preambles.push(mainRows[index]);
          index += 1;
        }
        drawPreamble(preambles);
        continue;
      }

      switch (sheetRow.type) {
        case 'header':
          drawRow(sheetRow.cells, {
            bold: true,
            height: 20,
            borderWidth: THICK_BORDER,
            fill: HEADER_FILL,
          });
          break;
        case 'subtotal':
        case 'grand-total': {
          const labelColspan = Math.min(
            Math.max(Number(sheetRow.meta?.labelColspan) || 1, 1),
            MAIN_COLUMN_WEIGHTS.length,
          );
          drawRow(sheetRow.cells, {
            bold: true,
            height: SUMMARY_ROW_HEIGHT,
            borderWidth: THIN_BORDER,
            outerBorderWidth: THICK_BORDER,
            fill: TOTAL_FILL,
            spans: [{ start: 0, end: labelColspan - 1 }],
            alignments: { 0: 'right' },
            fontSize: sheetRow.type === 'grand-total' ? 7 : MAIN_FONT_SIZE,
          });
          break;
        }
        case 'data':
          drawRow(sheetRow.cells, { outerVerticalBorderWidth: THICK_BORDER });
          break;
        case 'blank':
          ensureSpace(SUMMARY_SEPARATOR_HEIGHT);
          cursorY -= SUMMARY_SEPARATOR_HEIGHT;
          break;
        default:
          drawRow(sheetRow.cells || []);
      }
      index += 1;
    }

    if (resumoRows.length > 0) {
      drawResumo(resumoRows);
    }

    await fs.writeFile(filePath, await document.save());
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
