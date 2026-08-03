'use strict';

const crypto = require('crypto');

const MAX_TOKEN_BYTES = 16 * 1024;
const ALLOWED_ALG = 'EdDSA';
const ALLOWED_TYP = 'LICENSE';
const ALLOWED_VERSION = 1;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function encodeJson(obj) {
  return base64UrlEncode(Buffer.from(JSON.stringify(obj), 'utf8'));
}

function decodeJson(segment) {
  const raw = base64UrlDecode(segment).toString('utf8');
  return JSON.parse(raw);
}

function assertIsoDate(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${field}`);
  }
  return new Date(value).getTime();
}

/**
 * Sign a license lease with Ed25519.
 * @param {object} payload
 * @param {{ privateKey: string|Buffer|crypto.KeyObject, kid?: string }} options
 */
function signLease(payload, { privateKey, kid = 'license-key-1' } = {}) {
  if (!privateKey) {
    throw new Error('privateKey is required');
  }
  const header = { alg: ALLOWED_ALG, typ: ALLOWED_TYP, kid };
  const body = { leaseVersion: ALLOWED_VERSION, ...payload };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(body);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verify and decode a lease token.
 * @param {string} token
 * @param {{ publicKeys: Record<string, string|Buffer|crypto.KeyObject>, machineHash: string, nowMs?: number, maxClockSkewMs?: number }} options
 */
function verifyLease(token, options = {}) {
  const {
    publicKeys = {},
    machineHash,
    nowMs = Date.now(),
    maxClockSkewMs = MAX_CLOCK_SKEW_MS,
  } = options;

  if (typeof token !== 'string' || !token) {
    throw new Error('Lease token is required');
  }
  if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    throw new Error('Lease token too large');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Lease token must have three segments');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
  } catch {
    throw new Error('Lease token JSON is malformed');
  }

  if (header.alg !== ALLOWED_ALG) {
    throw new Error('Unsupported lease alg');
  }
  if (header.typ !== ALLOWED_TYP) {
    throw new Error('Unsupported lease typ');
  }
  if (payload.leaseVersion !== ALLOWED_VERSION) {
    throw new Error('Unsupported leaseVersion');
  }

  const key = publicKeys[header.kid];
  if (!key) {
    throw new Error('Unknown lease kid');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  let signature;
  try {
    signature = base64UrlDecode(encodedSignature);
  } catch {
    throw new Error('Invalid lease signature encoding');
  }

  const ok = crypto.verify(null, Buffer.from(signingInput, 'utf8'), key, signature);
  if (!ok) {
    throw new Error('Invalid lease signature');
  }

  if (typeof machineHash !== 'string' || machineHash.length !== 64) {
    throw new Error('machineHash is required for verification');
  }
  const expected = Buffer.from(machineHash, 'utf8');
  const actual = Buffer.from(String(payload.machineHash || ''), 'utf8');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Lease machineHash mismatch');
  }

  const issuedAt = assertIsoDate(payload.issuedAt, 'issuedAt');
  const checkAfter = assertIsoDate(payload.checkAfter, 'checkAfter');
  const subscriptionExpiresAt = assertIsoDate(
    payload.subscriptionExpiresAt,
    'subscriptionExpiresAt',
  );
  const graceUntil = assertIsoDate(payload.graceUntil, 'graceUntil');

  if (!(issuedAt <= checkAfter && checkAfter <= graceUntil)) {
    throw new Error('Lease dates out of order');
  }
  if (!(checkAfter <= subscriptionExpiresAt || subscriptionExpiresAt === checkAfter)) {
    // checkAfter may equal or be before subscriptionExpiresAt
  }
  if (checkAfter > subscriptionExpiresAt) {
    throw new Error('checkAfter exceeds subscriptionExpiresAt');
  }
  if (issuedAt > nowMs + maxClockSkewMs) {
    throw new Error('Lease issuedAt is too far in the future');
  }

  return { header, payload };
}

module.exports = {
  signLease,
  verifyLease,
  base64UrlEncode,
  base64UrlDecode,
  MAX_TOKEN_BYTES,
};
