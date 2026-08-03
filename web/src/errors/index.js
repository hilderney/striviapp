class AppError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

class ScannerError extends AppError {}
class ExtractionError extends AppError {}
class ExportError extends AppError {}
class LinkerError extends AppError {}
class LlmError extends AppError {
  constructor(message, { code, statusCode, cause } = {}) {
    super(message, cause);
    this.code = code;
    this.statusCode = statusCode;
  }
}
class PersistenceError extends AppError {}
class ValidationError extends AppError {}
class CryptoError extends AppError {}
class FileReaderError extends AppError {}
class SpreadsheetError extends AppError {
  constructor(message, { code, cause } = {}) {
    super(message, cause);
    this.code = code;
  }
}
class LogViewerError extends AppError {
  constructor(message, { statusCode = 500, code, cause } = {}) {
    super(message, cause);
    this.name = 'LogViewerError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class AuthError extends AppError {
  constructor(message, { statusCode = 401, code, cause } = {}) {
    super(message, cause);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class TotpError extends AppError {
  constructor(message, { statusCode = 400, code, cause } = {}) {
    super(message, cause);
    this.name = 'TotpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = {
  AppError,
  ScannerError,
  ExtractionError,
  ExportError,
  LinkerError,
  LlmError,
  PersistenceError,
  ValidationError,
  CryptoError,
  FileReaderError,
  SpreadsheetError,
  LogViewerError,
  AuthError,
  TotpError,
};
