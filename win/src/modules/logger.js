const { createLoggerAdapter } = require('../adapters/loggerAdapter');

function createSessionId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = Math.random().toString(36).slice(2, 8);
  return `${timestamp}_${shortId}`;
}

function createLogger(moduleName, options = {}) {
  const {
    logsDir = './logs',
    adapterType = 'pino',
    sessionId = createSessionId(),
    loggerAdapter,
    fs = require('fs'),
    path = require('path'),
  } = options;

  fs.mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, `session_${sessionId}.log`);

  const adapter =
    loggerAdapter ||
    createLoggerAdapter(adapterType, {
      logFilePath,
      moduleName,
    });

  const writeSafe = (level, message, dataOrError) => {
    try {
      const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        module: moduleName,
      };

      if (dataOrError instanceof Error) {
        entry.error = {
          message: dataOrError.message,
          stack: dataOrError.stack,
          name: dataOrError.name,
        };
      } else if (dataOrError !== undefined) {
        entry.data = dataOrError;
      }

      adapter.write(entry);
    } catch {
      // Must not throw during batch failures (RED-42)
    }
  };

  return {
    sessionId,
    logFilePath,
    info: (message, data) => writeSafe('info', message, data),
    warn: (message, data) => writeSafe('warn', message, data),
    error: (message, dataOrError) => writeSafe('error', message, dataOrError),
    debug: (message, data) => writeSafe('debug', message, data),
    close: () => adapter.close(),
  };
}

module.exports = {
  createSessionId,
  createLogger,
};
