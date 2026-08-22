'use strict';

const { AuthError } = require('../errors');

/**
 * Timer block da build de demonstração.
 * Válido até o fim de 25/11/2026 (fuso America/Sao_Paulo).
 * A partir de 26/11/2026 00:00 -03:00 o backend recusa login e operações.
 *
 * A checagem usa o relógio do servidor (processo Node/Electron) — a UI sozinha
 * não basta; login, refresh e rotas autenticadas passam por aqui.
 */
const DEMO_EXPIRES_AT_MS = Date.parse('2026-11-26T00:00:00-03:00');
const DEMO_EXPIRES_LABEL = '25/11/2026';
const DEMO_EXPIRED_MESSAGE =
  'O limite do software de demonstração foi atingido.';

function isDemoExpired(nowMs = Date.now()) {
  return Number.isFinite(nowMs) && nowMs >= DEMO_EXPIRES_AT_MS;
}

function assertDemoActive(nowMs = Date.now()) {
  if (isDemoExpired(nowMs)) {
    throw new AuthError(DEMO_EXPIRED_MESSAGE, {
      statusCode: 403,
      code: 'DEMO_EXPIRED',
    });
  }
}

module.exports = {
  DEMO_EXPIRES_AT_MS,
  DEMO_EXPIRES_LABEL,
  DEMO_EXPIRED_MESSAGE,
  isDemoExpired,
  assertDemoActive,
};
