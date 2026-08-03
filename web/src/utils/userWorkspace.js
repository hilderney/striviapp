const path = require('path');
const { AuthError } = require('../errors');

// Usado quando o servidor roda sem authService (testes Fases 1–4).
const OPEN_MODE_USER_ID = 'local-open-user';

/**
 * Converte userId em nome de pasta seguro (UUID ou slug).
 * Rejeita path traversal e segmentos vazios.
 */
function sanitizeUserIdForPath(userId) {
  const raw = String(userId ?? '').trim();
  if (!raw || raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
    throw new AuthError('Invalid user workspace id', {
      statusCode: 400,
      code: 'INVALID_WORKSPACE',
    });
  }
  // Mantém UUID e open-mode; demais caracteres viram underscore.
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') {
    throw new AuthError('Invalid user workspace id', {
      statusCode: 400,
      code: 'INVALID_WORKSPACE',
    });
  }
  return safe;
}

function resolveUserDir(baseDir, userId) {
  const safeId = sanitizeUserIdForPath(userId);
  return path.resolve(path.join(path.resolve(baseDir), safeId));
}

function resolveUserWorkspace(ctx, auth) {
  const userId = auth?.userId ?? OPEN_MODE_USER_ID;
  return {
    userId,
    outputDir: resolveUserDir(ctx.outputDir, userId),
    stagingDir: resolveUserDir(ctx.stagingDir, userId),
  };
}

module.exports = {
  OPEN_MODE_USER_ID,
  sanitizeUserIdForPath,
  resolveUserDir,
  resolveUserWorkspace,
};
