'use strict';

const {
  DEMO_EXPIRES_AT_MS,
  DEMO_EXPIRES_LABEL,
  DEMO_EXPIRED_MESSAGE,
  isDemoExpired,
  assertDemoActive,
} = require('../src/modules/demoExpiry');
const { AuthError } = require('../src/errors');

describe('demoExpiry (timer block)', () => {
  test('ainda válido em 25/11/2026 23:59 -03:00', () => {
    expect(isDemoExpired(Date.parse('2026-11-25T23:59:59.999-03:00'))).toBe(false);
    expect(() => assertDemoActive(Date.parse('2026-11-25T23:59:59.999-03:00'))).not.toThrow();
  });

  test('expira a partir de 26/11/2026 00:00 -03:00', () => {
    expect(isDemoExpired(DEMO_EXPIRES_AT_MS)).toBe(true);
    expect(isDemoExpired(Date.parse('2026-11-26T00:00:00-03:00'))).toBe(true);
    expect(() => assertDemoActive(DEMO_EXPIRES_AT_MS)).toThrow(AuthError);
    try {
      assertDemoActive(DEMO_EXPIRES_AT_MS);
    } catch (error) {
      expect(error.code).toBe('DEMO_EXPIRED');
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe(DEMO_EXPIRED_MESSAGE);
    }
  });

  test('rótulo da assinatura demo', () => {
    expect(DEMO_EXPIRES_LABEL).toBe('25/11/2026');
  });
});
