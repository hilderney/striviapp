const path = require('path');
const { createLogger } = require('../modules/logger');
const { listPdfs } = require('../modules/scanner');
const { extractBatch } = require('../modules/extractor');
const { exportCsv, exportXlsx } = require('../modules/exporter');
const { createServer } = require('../modules/linker');

class PdfSummarizerBuilder {
  constructor() {
    this._inputDir = null;
    this._outputDir = './output';
    this._logsDir = './logs';
    this._recursive = false;
    this._overwrite = false;
    this._formats = ['csv', 'xlsx'];
    this._serve = true;
    this._port = 4000;
    this._host = '127.0.0.1';
  }

  static create() {
    return new PdfSummarizerBuilder();
  }

  fromDirectory(inputDir) {
    this._inputDir = inputDir;
    return this;
  }

  outputTo(outputDir) {
    this._outputDir = outputDir;
    return this;
  }

  withLogs(logsDir) {
    this._logsDir = logsDir;
    return this;
  }

  recursive(value = true) {
    this._recursive = value;
    return this;
  }

  overwrite(value = true) {
    this._overwrite = value;
    return this;
  }

  exportFormats(formats) {
    this._formats = formats;
    return this;
  }

  serveLinks(port = 4000, host = '127.0.0.1') {
    this._serve = true;
    this._port = port;
    this._host = host;
    return this;
  }

  withoutServer() {
    this._serve = false;
    return this;
  }

  build() {
    return new PdfSummarizerPipeline(this);
  }

  getConfig() {
    return {
      inputDir: this._inputDir,
      outputDir: path.resolve(this._outputDir),
      logsDir: path.resolve(this._logsDir),
      recursive: this._recursive,
      overwrite: this._overwrite,
      formats: [...this._formats],
      serve: this._serve,
      port: this._port,
      host: this._host,
    };
  }
}

class PdfSummarizerPipeline {
  constructor(builder) {
    this.config = builder.getConfig();
    this.logger = null;
    this.server = null;
  }

  async run() {
    const config = this.config;

    if (!config.inputDir) {
      throw new Error('Input directory is required. Use fromDirectory().');
    }

    this.logger = createLogger('pipeline', { logsDir: config.logsDir });
    this.logger.info('Pipeline started', config);

    const pdfs = await listPdfs(config.inputDir, { recursive: config.recursive });
    this.logger.info('PDFs scanned', { count: pdfs.length, inputDir: config.inputDir });

    const batch = await extractBatch(
      pdfs.map((pdf) => pdf.path),
      config.outputDir,
      { overwrite: config.overwrite },
    );

    for (const result of batch.results) {
      this.logger.info('PDF extracted', {
        inputFile: result.inputFile,
        outputFile: result.outputFile,
        pageCount: result.pageCount,
        charCount: result.charCount,
      });
    }

    for (const item of batch.errors) {
      this.logger.error('PDF extraction failed', item.error);
    }

    const exports = { csv: [], xlsx: [] };

    if (config.formats.includes('csv')) {
      for (const result of batch.results) {
        const exported = await exportCsv([result], config.outputDir);
        exports.csv.push(exported);
        this.logger.info('CSV exported', exported);
      }
    }

    const wantsExcel = config.formats.some((format) =>
      ['xlsx', 'xls', 'excel'].includes(format),
    );

    if (wantsExcel) {
      for (const result of batch.results) {
        const exported = await exportXlsx([result], config.outputDir);
        exports.xlsx.push(exported);
        this.logger.info('Excel exported', exported);
      }
    }

    if (config.serve) {
      this.server = await createServer({
        port: config.port,
        host: config.host,
        outputDir: config.outputDir,
      });
      this.logger.info('Link server started', { url: this.server.url });
    }

    const summary = {
      scanned: pdfs.length,
      extracted: batch.results.length,
      failed: batch.errors.length,
      exports,
      logFile: this.logger.logFilePath,
      serverUrl: this.server?.url || null,
      files: batch.results,
    };

    this.logger.info('Pipeline completed', {
      scanned: summary.scanned,
      extracted: summary.extracted,
      failed: summary.failed,
    });

    return summary;
  }

  async close() {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    if (this.logger) {
      await this.logger.close();
    }
  }
}

module.exports = {
  PdfSummarizerBuilder,
  PdfSummarizerPipeline,
};
