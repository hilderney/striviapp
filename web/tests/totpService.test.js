const {
  generateTotpSecret,
  buildOtpauthUri,
  generateTotpCode,
  verifyTotpCode,
} = require('../src/modules/totpService');

// Vetor da RFC 6238 (Apêndice B): segredo ASCII "12345678901234567890" em base32.
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totpService', () => {
  test('[F5-01] generateTotpSecret retorna base32 válido com entropia suficiente', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // 20 bytes → 32 caracteres base32
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  test('[F5-02] generateTotpCode produz vetor conhecido da RFC 6238 (SHA-1)', () => {
    // RFC 6238: T=59s → TOTP de 8 dígitos "94287082"; os 6 finais são "287082".
    const code = generateTotpCode(RFC_SECRET_BASE32, { now: () => 59 * 1000, digits: 8 });
    expect(code).toBe('94287082');
  });

  test('[F5-03] verifyTotpCode aceita código do step atual', () => {
    const now = () => 1_000_000_000_000;
    const code = generateTotpCode(RFC_SECRET_BASE32, { now });
    expect(verifyTotpCode(RFC_SECRET_BASE32, code, { now })).toBe(true);
  });

  test('[F5-04] verifyTotpCode aceita código do step anterior/seguinte (janela ±1)', () => {
    const baseMs = 1_000_000_000_000;
    const previousStepCode = generateTotpCode(RFC_SECRET_BASE32, { now: () => baseMs - 30_000 });
    const nextStepCode = generateTotpCode(RFC_SECRET_BASE32, { now: () => baseMs + 30_000 });

    expect(verifyTotpCode(RFC_SECRET_BASE32, previousStepCode, { now: () => baseMs })).toBe(true);
    expect(verifyTotpCode(RFC_SECRET_BASE32, nextStepCode, { now: () => baseMs })).toBe(true);
  });

  test('[F5-05] verifyTotpCode rejeita código de 2 steps atrás', () => {
    const baseMs = 1_000_000_000_000;
    const staleCode = generateTotpCode(RFC_SECRET_BASE32, { now: () => baseMs - 60_000 });
    expect(verifyTotpCode(RFC_SECRET_BASE32, staleCode, { now: () => baseMs })).toBe(false);
  });

  test('[F5-06] verifyTotpCode rejeita código malformado', () => {
    const now = () => 1_000_000_000_000;
    expect(verifyTotpCode(RFC_SECRET_BASE32, 'abcdef', { now })).toBe(false);
    expect(verifyTotpCode(RFC_SECRET_BASE32, '12345', { now })).toBe(false);
    expect(verifyTotpCode(RFC_SECRET_BASE32, null, { now })).toBe(false);
    expect(verifyTotpCode(RFC_SECRET_BASE32, 123456, { now })).toBe(false);
  });

  test('[F5-07] buildOtpauthUri contém issuer, username e secret', () => {
    const uri = buildOtpauthUri({
      secret: RFC_SECRET_BASE32,
      username: 'maria',
      issuer: 'Striviapp',
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('maria');
    expect(uri).toContain(`secret=${RFC_SECRET_BASE32}`);
    expect(uri).toContain('issuer=Striviapp');
    expect(uri).toContain('period=30');
    expect(uri).toContain('digits=6');
  });
});
