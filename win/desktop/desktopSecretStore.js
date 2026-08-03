'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 1;

class SecureStorageUnavailableError extends Error {
  constructor() {
    super('SECURE_STORAGE_UNAVAILABLE');
    this.name = 'SecureStorageUnavailableError';
    this.code = 'SECURE_STORAGE_UNAVAILABLE';
  }
}

function newHexKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Segredos locais protegidos pelo DPAPI via Electron safeStorage (FASE 7 §7).
 * safeStorage só pode ser usado depois de app.whenReady().
 *
 * @param {{ filePath: string, safeStorage: import('electron').SafeStorage }} options
 */
function createDesktopSecretStore({ filePath, safeStorage } = {}) {
  if (!filePath) {
    throw new Error('filePath is required');
  }
  if (!safeStorage) {
    throw new Error('safeStorage is required');
  }

  function isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  function writeAtomic(payload) {
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, encrypted, { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  }

  function read() {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath);
    const decrypted = safeStorage.decryptString(raw);
    const parsed = JSON.parse(decrypted);
    if (parsed.version !== STORE_VERSION) {
      throw new Error('Unsupported secret store version');
    }
    return parsed;
  }

  return {
    isAvailable,

    /**
     * Carrega os segredos da instalação, criando na primeira execução.
     * Falha fechada quando o DPAPI não está disponível.
     */
    loadOrCreate() {
      if (!isAvailable()) {
        throw new SecureStorageUnavailableError();
      }

      const existing = read();
      if (existing) {
        return existing;
      }

      const created = {
        version: STORE_VERSION,
        appSecretKey: newHexKey(),
        jwtSecret: newHexKey(),
        activationToken: null,
      };
      writeAtomic(created);
      return created;
    },

    save(payload) {
      if (!isAvailable()) {
        throw new SecureStorageUnavailableError();
      }
      writeAtomic({ ...payload, version: STORE_VERSION });
    },
  };
}

module.exports = {
  STORE_VERSION,
  SecureStorageUnavailableError,
  createDesktopSecretStore,
};
