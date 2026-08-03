const crypto = require('crypto');
const { CryptoError } = require('../errors');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(secret, keyEnv = 'APP_SECRET_KEY') {
  const raw = secret ?? process.env[keyEnv];
  if (!raw) {
    throw new CryptoError(`Missing encryption key. Set ${keyEnv} environment variable.`);
  }

  if (Buffer.isBuffer(raw)) {
    if (raw.length !== 32) {
      throw new CryptoError('Encryption key must be 32 bytes');
    }
    return raw;
  }

  const trimmed = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // fall through to hash
  }

  return crypto.createHash('sha256').update(trimmed).digest();
}

function encrypt(plaintext, options = {}) {
  if (plaintext == null || plaintext === '') {
    return null;
  }

  try {
    const key = deriveKey(options.secret, options.keyEnv);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('Failed to encrypt token', error);
  }
}

function decrypt(ciphertext, options = {}) {
  if (ciphertext == null || ciphertext === '') {
    return null;
  }

  try {
    const key = deriveKey(options.secret, options.keyEnv);
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('Failed to decrypt token', error);
  }
}

function createCryptoAdapter(options = {}) {
  return {
    encrypt: (plaintext) => encrypt(plaintext, options),
    decrypt: (ciphertext) => decrypt(ciphertext, options),
  };
}

module.exports = {
  deriveKey,
  encrypt,
  decrypt,
  createCryptoAdapter,
};
