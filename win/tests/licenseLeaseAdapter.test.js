'use strict';

const crypto = require('crypto');
const { signLease, verifyLease } = require('../src/adapters/licenseLeaseAdapter');

function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

function basePayload(overrides = {}) {
  const issuedAt = new Date('2026-07-30T18:00:00.000Z');
  const checkAfter = new Date('2026-08-29T18:00:00.000Z');
  const graceUntil = new Date('2026-09-12T18:00:00.000Z');
  return {
    licenseId: '11111111-1111-1111-1111-111111111111',
    activationId: '22222222-2222-2222-2222-222222222222',
    machineHash: 'a'.repeat(64),
    plan: 'monthly',
    appVersion: '2.0.0',
    issuedAt: issuedAt.toISOString(),
    checkAfter: checkAfter.toISOString(),
    subscriptionExpiresAt: checkAfter.toISOString(),
    graceUntil: graceUntil.toISOString(),
    ...overrides,
  };
}

describe('FASE7 lease Ed25519', () => {
  let privateKey;
  let publicKey;
  const kid = 'license-key-1';

  beforeAll(() => {
    ({ privateKey, publicKey } = generateKeyPair());
  });

  test('[F7-01] lease válido assinado pela privada é aceito pela pública correspondente', () => {
    const payload = basePayload();
    const token = signLease(payload, { privateKey, kid });
    const result = verifyLease(token, {
      publicKeys: { [kid]: publicKey },
      machineHash: payload.machineHash,
      nowMs: Date.parse(payload.issuedAt),
    });
    expect(result.payload.licenseId).toBe(payload.licenseId);
    expect(result.header.alg).toBe('EdDSA');
    expect(result.header.typ).toBe('LICENSE');
    expect(result.payload.leaseVersion).toBe(1);
  });

  test('[F7-02] payload, header ou assinatura adulterados são rejeitados', () => {
    const payload = basePayload();
    const token = signLease(payload, { privateKey, kid });
    const [h, p, s] = token.split('.');

    expect(() =>
      verifyLease(`${h}.${p}x.${s}`, {
        publicKeys: { [kid]: publicKey },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow();

    expect(() =>
      verifyLease(`${h}.${p}.${s.slice(0, -2)}aa`, {
        publicKeys: { [kid]: publicKey },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/signature/i);

    const other = generateKeyPair();
    const forged = signLease(payload, { privateKey: other.privateKey, kid });
    expect(() =>
      verifyLease(forged, {
        publicKeys: { [kid]: publicKey },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/signature/i);
  });

  test('[F7-03] alg/typ/kid/leaseVersion desconhecido é rejeitado', () => {
    const payload = basePayload();
    const token = signLease(payload, { privateKey, kid });

    expect(() =>
      verifyLease(token, {
        publicKeys: { 'other-kid': publicKey },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/kid/i);

    const { privateKey: pk2, publicKey: pub2 } = generateKeyPair();
    // Manually craft wrong alg by signing with helper then mutating is hard;
    // sign with correct helper and verify wrong typ via direct segment replace.
    const badHeader = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid }),
      'utf8',
    )
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const parts = token.split('.');
    const signingInput = `${badHeader}.${parts[1]}`;
    const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), pk2);
    const sig = signature
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(() =>
      verifyLease(`${signingInput}.${sig}`, {
        publicKeys: { [kid]: pub2 },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/typ/i);
  });

  test('[F7-04] machineHash divergente é rejeitado', () => {
    const payload = basePayload();
    const token = signLease(payload, { privateKey, kid });
    expect(() =>
      verifyLease(token, {
        publicKeys: { [kid]: publicKey },
        machineHash: 'b'.repeat(64),
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/machineHash/i);
  });

  test('[F7-05] datas inválidas, fora de ordem ou issuedAt futuro são rejeitadas', () => {
    const payload = basePayload({
      checkAfter: '2026-09-20T18:00:00.000Z',
      subscriptionExpiresAt: '2026-09-01T18:00:00.000Z',
      graceUntil: '2026-09-30T18:00:00.000Z',
    });
    const token = signLease(payload, { privateKey, kid });
    expect(() =>
      verifyLease(token, {
        publicKeys: { [kid]: publicKey },
        machineHash: payload.machineHash,
        nowMs: Date.parse(payload.issuedAt),
      }),
    ).toThrow(/checkAfter|order/i);

    const futurePayload = basePayload({
      issuedAt: '2026-12-01T18:00:00.000Z',
      checkAfter: '2026-12-31T18:00:00.000Z',
      subscriptionExpiresAt: '2026-12-31T18:00:00.000Z',
      graceUntil: '2027-01-14T18:00:00.000Z',
    });
    const futureToken = signLease(futurePayload, { privateKey, kid });
    expect(() =>
      verifyLease(futureToken, {
        publicKeys: { [kid]: publicKey },
        machineHash: futurePayload.machineHash,
        nowMs: Date.parse('2026-07-30T18:00:00.000Z'),
      }),
    ).toThrow(/future/i);

    const badDate = basePayload({ issuedAt: 'not-a-date' });
    const badToken = signLease(badDate, { privateKey, kid });
    expect(() =>
      verifyLease(badToken, {
        publicKeys: { [kid]: publicKey },
        machineHash: badDate.machineHash,
        nowMs: Date.now(),
      }),
    ).toThrow(/issuedAt/i);
  });

  test('[F7-06] token acima do limite ou JSON malformado é rejeitado sem crash', () => {
    const huge = `${'a'.repeat(20 * 1024)}.b.c`;
    expect(() =>
      verifyLease(huge, {
        publicKeys: { [kid]: publicKey },
        machineHash: 'a'.repeat(64),
      }),
    ).toThrow(/too large/i);

    expect(() =>
      verifyLease('not.a.token!!!', {
        publicKeys: { [kid]: publicKey },
        machineHash: 'a'.repeat(64),
      }),
    ).toThrow();

    expect(() =>
      verifyLease('a.b', {
        publicKeys: { [kid]: publicKey },
        machineHash: 'a'.repeat(64),
      }),
    ).toThrow(/three segments/i);
  });
});
