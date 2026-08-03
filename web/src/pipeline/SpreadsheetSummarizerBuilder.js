const path = require('path');
const { createLogger } = require('../modules/logger');
const { createServer } = require('../modules/linker');
const { importSpreadsheet, listSpreadsheets } = require('../modules/spreadsheetImporter');

class SpreadsheetSummarizerBuilder {
  constructor() {
    this._sourceFile = null;
    this._inputDir = process.env.INPUT_DIR || './input';
    this._outputDir = process.env.OUTPUT_DIR || './output';
    this._logsDir = './logs';
    this._formats = ['csv', 'xlsx'];
    this._overwrite = true;
    this._serve = true;
    this._port = 4000;
    this._host = '127.0.0.1';
    this._fromDirectoryMode = false;
    this._recursive = false;
  }

  static create() {
    return new SpreadsheetSummarizerBuilder();
  }

  fromSpreadsheet(sourceFile) {
    this._sourceFile = sourceFile;
    this._fromDirectoryMode = false;
    return this;
  }

  fromDirectory(inputDir, options = {}) {
    this._inputDir = inputDir;
    this._fromDirectoryMode = true;
    this._recursive = Boolean(options.recursive);
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

  exportFormats(formats) {
    this._formats = formats;
    return this;
  }

  overwrite(value = true) {
    this._overwrite = value;
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
    return new SpreadsheetSummarizerPipeline(this);
  }

  getConfig() {
    return {
      sourceFile: this._sourceFile,
      inputDir: path.resolve(this._inputDir),
      outputDir: path.resolve(this._outputDir),
      logsDir: path.resolve(this._logsDir),
      formats: [...this._formats],
      overwrite: this._overwrite,
      serve: this._serve,
      port: this._port,
      host: this._host,
      fromDirectoryMode: this._fromDirectoryMode,
      recursive: this._recursive,
    };
  }
}

class SpreadsheetSummarizerPipeline {
  constructor(builder) {
    this.config = builder.getConfig();
    this.logger = null;
    this.server = null;
  }

  async run() {
    const config = this.config;

    if (!config.fromDirectoryMode && !config.sourceFile) {
      throw new Error('Spreadsheet source is required. Use fromSpreadsheet().');
    }

    this.logger = createLogger('spreadsheet-pipeline', { logsDir: config.logsDir });
    this.logger.info('Spreadsheet pipeline started', config);

    const imports = [];
    const sourceFiles = config.fromDirectoryMode
      ? (await listSpreadsheets(config.inputDir, { recursive: config.recursive })).map(
          (file) => file.name,
        )
      : [config.sourceFile];

    if (sourceFiles.length === 0) {
      throw new Error(`No spreadsheets found in ${config.inputDir}`);
    }

    for (const sourceFile of sourceFiles) {
      const result = await importSpreadsheet(sourceFile, {
        inputDir: config.inputDir,
        outputDir: config.outputDir,
        formats: config.formats,
        overwrite: config.overwrite,
        logsDir: config.logsDir,
        logger: this.logger,
        baseUrl: this.server?.url || null,
      });
      imports.push(result);
    }

    if (config.serve) {
      this.server = await createServer({
        port: config.port,
        host: config.host,
        outputDir: config.outputDir,
      });
      this.logger.info('Link server started', { url: this.server.url });

      for (const item of imports) {
        if (item.exports.csv) {
          item.exports.csv.url = `${this.server.url}/open/${encodeURIComponent(path.basename(item.exports.csv.filePath))}`;
        }
        if (item.exports.xlsx) {
          item.exports.xlsx.url = `${this.server.url}/open/${encodeURIComponent(path.basename(item.exports.xlsx.filePath))}`;
        }
      }
    }

    const summary = {
      imported: imports.length,
      imports,
      logFile: this.logger.logFilePath,
      serverUrl: this.server?.url || null,
    };

    this.logger.info('Spreadsheet pipeline completed', { imported: summary.imported });
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
  SpreadsheetSummarizerBuilder,
  SpreadsheetSummarizerPipeline,
};
