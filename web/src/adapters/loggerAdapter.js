const fs = require('fs');
const path = require('path');
const pino = require('pino');

class LoggerAdapter {
  write(_entry) {
    throw new Error('LoggerAdapter.write() must be implemented');
  }
}

class PinoLoggerAdapter extends LoggerAdapter {
  constructor({ logFilePath, moduleName }) {
    super();
    this.moduleName = moduleName;
    this.stream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.pino = pino(
      {
        level: 'debug',
        base: { module: moduleName },
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      this.stream,
    );
  }

  write(entry) {
    const { level, message, data, error } = entry;
    const payload = { ...(data || {}) };
    if (error) {
      payload.err = error;
    }
    this.pino[level](payload, message);
  }

  close() {
    return new Promise((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on('error', reject);
    });
  }
}

function createLoggerAdapter(type, options) {
  switch (type) {
    case 'pino':
      return new PinoLoggerAdapter(options);
    default:
      throw new Error(`Unknown logger adapter: ${type}`);
  }
}

module.exports = {
  LoggerAdapter,
  PinoLoggerAdapter,
  createLoggerAdapter,
};
