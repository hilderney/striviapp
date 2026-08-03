const { signJwt, verifyJwt } = require('../src/adapters/jwtAdapter');
const { AuthError } = require('../src/errors');

const SECRET = 'test-secret';
const NOW_MS = 1_700_000_000_000;

describe('jwtAdapter', () => {
  test('[F5-08] signJwt/verifyJwt roundtrip preserva claims', () => {
    const token = signJwt(
      { sub: 'user-1', role: 'ADM', kind: 'access' },
      { secret: SECRET, expiresInSeconds: 900, now: () => NOW_MS },
    );

    const claims = verifyJwt(token, { secret: SECRET, now: () => NOW_MS });
    expect(claims).toMatchObject({ sub: 'user-1', role: 'ADM', kind: 'access' });
    expect(claims.exp - claims.iat).toBe(900);
  });

  test('[F5-09] verifyJwt rejeita assinatura adulterada (TOKEN_INVALID 401)', () => {
    const token = signJwt(
      { sub: 'user-1' },
      { secret: SECRET, expiresInSeconds: 900, now: () => NOW_MS },
    );
    const [header, payload] = token.split('.');
    const forged = `${header}.${payload}.${'A'.repeat(43)}`;

    expect(() => verifyJwt(forged, { secret: SECRET, now: () => NOW_MS })).toThrow(AuthError);
    try {
      verifyJwt(forged, { secret: SECRET, now: () => NOW_MS });
    } catch (error) {
      expect(error.code).toBe('TOKEN_INVALID');
      expect(error.statusCode).toBe(401);
    }
  });

  test('[F5-10] verifyJwt rejeita token expirado (TOKEN_EXPIRED 401)', () => {
    const token = signJwt(
      { sub: 'user-1' },
      { secret: SECRET, expiresInSeconds: 60, now: () => NOW_MS },
    );

    expect(() =>
      verifyJwt(token, { secret: SECRET, now: () => NOW_MS + 61_000 }),
    ).toThrow(expect.objectContaining({ code: 'TOKEN_EXPIRED', statusCode: 401 }));
  });
});
