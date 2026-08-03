const crypto = require('crypto');
const { TotpError } = require('../errors');

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1;
const SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret) {
  const normalized = String(secret).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new TotpError('Invalid base32 secret', { code: 'INVALID_SECRET' });
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return encodeBase32(crypto.randomBytes(SECRET_BYTES));
}

function buildOtpauthUri({ secret, username, issuer = 'Striviapp' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

function computeCodeForCounter(secretBuffer, counter, digits) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226 §5.4): 4 bytes a partir do offset dado pelo nibble final.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function generateTotpCode(secret, options = {}) {
  const {
    now = () => Date.now(),
    stepSeconds = TOTP_STEP_SECONDS,
    digits = TOTP_DIGITS,
  } = options;

  const counter = Math.floor(now() / 1000 / stepSeconds);
  return computeCodeForCounter(decodeBase32(secret), counter, digits);
}

function verifyTotpCode(secret, code, options = {}) {
  const {
    now = () => Date.now(),
    stepSeconds = TOTP_STEP_SECONDS,
    digits = TOTP_DIGITS,
    windowSteps = TOTP_WINDOW_STEPS,
  } = options;

  if (typeof code !== 'string' || !new RegExp(`^\\d{${digits}}$`).test(code)) {
    return false;
  }

  const secretBuffer = decodeBase32(secret);
  const currentCounter = Math.floor(now() / 1000 / stepSeconds);

  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const candidate = computeCodeForCounter(secretBuffer, currentCounter + offset, digits);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      return true;
    }
  }

  return false;
}

module.exports = {
  TOTP_STEP_SECONDS,
  TOTP_DIGITS,
  generateTotpSecret,
  buildOtpauthUri,
  generateTotpCode,
  verifyTotpCode,
};
