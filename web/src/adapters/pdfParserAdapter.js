class PdfParserAdapter {
  async parse(_buffer) {
    throw new Error('PdfParserAdapter.parse() must be implemented');
  }
}

class PdfParseV2Adapter extends PdfParserAdapter {
  constructor(pdfParseModule = require('pdf-parse')) {
    super();
    this.PDFParse = pdfParseModule.PDFParse;
  }

  async parse(buffer) {
    const parser = new this.PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = (result.text || '').replace(/\n-- \d+ of \d+ --\n/g, '\n').trim();
    return {
      text,
      pageCount: result.total || 0,
    };
  }
}

class PdfParseV1Adapter extends PdfParserAdapter {
  constructor(pdfParseModule = require('pdf-parse')) {
    super();
    this.pdfParse = typeof pdfParseModule === 'function'
      ? pdfParseModule
      : pdfParseModule.default;
  }

  async parse(buffer) {
    const data = await this.pdfParse(buffer);
    return {
      text: data.text || '',
      pageCount: data.numpages || 0,
    };
  }
}

function createPdfParserAdapter(type = 'pdf-parse-v2') {
  switch (type) {
    case 'pdf-parse':
    case 'pdf-parse-v1':
      return new PdfParseV1Adapter();
    case 'pdf-parse-v2':
      return new PdfParseV2Adapter();
    default:
      throw new Error(`Unknown PDF parser adapter: ${type}`);
  }
}

module.exports = {
  PdfParserAdapter,
  PdfParseV1Adapter,
  PdfParseV2Adapter,
  createPdfParserAdapter,
};
