const crypto = require('crypto');
const { AuthError } = require('../errors');

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function hmacSignature(signingInput, secret) {
  return crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
}

function signJwt(payload, { secret, expiresInSeconds, now = () => Date.now() }) {
  if (!secret) {
    throw new AuthError('JWT secret is required', { statusCode: 500, code: 'MISSING_SECRET' });
  }

  const issuedAtSeconds = Math.floor(now() / 1000);
  const claims = {
    ...payload,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + expiresInSeconds,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(JWT_HEADER))}.${base64UrlEncode(
    JSON.stringify(claims),
  )}`;
  return `${signingInput}.${hmacSignature(signingInput, secret)}`;
}

function verifyJwt(token, { secret, now = () => Date.now() }) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new AuthError('Malformed token', { code: 'TOKEN_INVALID' });
  }

  const [encodedHeader, encodedPayload, signature] = token.split('.');
  const expectedSignature = hmacSignature(`${encodedHeader}.${encodedPayload}`, secret);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new AuthError('Invalid token signature', { code: 'TOKEN_INVALID' });
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('Malformed token payload', { code: 'TOKEN_INVALID' });
  }

  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now()) {
    throw new AuthError('Token expired', { code: 'TOKEN_EXPIRED' });
  }

  return claims;
}

module.exports = {
  signJwt,
  verifyJwt,
};
