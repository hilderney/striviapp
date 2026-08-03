const { createAuthService } = require('../src/modules/authService');
const { generateTotpCode } = require('../src/modules/totpService');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { AuthError } = require('../src/errors');

const TEST_KEY = Buffer.alloc(32, 7).toString('hex');
const JWT_SECRET = 'jwt-test-secret';

function createService({ nowMs = 1_700_000_000_000 } = {}) {
  const clock = { ms: nowMs };
  const persistence = createPersistenceAdapter('memory');
  const service = createAuthService({
    persistence,
    cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    jwtSecret: JWT_SECRET,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3600,
    elevationTtlSeconds: 900,
    now: () => clock.ms,
  });
  return { service, persistence, clock };
}

async function createEnabledTotpUser(service, clock, { username = 'maria', role = 'USER' } = {}) {
  const user = await service.createUser({ username, password: 'senha-forte', role });
  const { secret } = await service.setupTotp(user.id);
  await service.confirmTotp(user.id, generateTotpCode(secret, { now: () => clock.ms }));
  return { user, secret };
}

describe('authService — usuários e login', () => {
  let service;
  let persistence;
  let clock;

  beforeEach(async () => {
    ({ service, persistence, clock } = createService());
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  test('[F5-11] seedAdminIfEmpty cria ADM apenas quando não há usuários', async () => {
    const seeded = await service.seedAdminIfEmpty({ username: 'admin', password: 'boot123' });
    expect(seeded).toMatchObject({ username: 'admin', role: 'ADM', totpEnabled: false });

    const again = await service.seedAdminIfEmpty({ username: 'other', password: 'x' });
    expect(again).toBeNull();
    expect(await service.listUsers()).toHaveLength(1);
  });

  test('[F5-12] createUser rejeita role inválida e username duplicado', async () => {
    await expect(
      service.createUser({ username: 'a', password: 'b', role: 'ROOT' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ROLE' });

    await service.createUser({ username: 'a', password: 'b', role: 'USER' });
    await expect(
      service.createUser({ username: 'a', password: 'c', role: 'USER' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'USERNAME_TAKEN' });
  });

  test('[F5-13] login com credenciais corretas retorna par de tokens + user sem hash', async () => {
    await service.createUser({ username: 'maria', password: 'senha-forte', role: 'ADM' });
    const session = await service.login({ username: 'maria', password: 'senha-forte' });

    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken).toMatch(/^[0-9a-f]{96}$/);
    expect(session.expiresInSeconds).toBe(900);
    expect(session.user).toMatchObject({ username: 'maria', role: 'ADM' });
    expect(session.user.passwordHash).toBeUndefined();
    expect(session.user.password_hash).toBeUndefined();
  });

  test('[F5-14] login com senha errada ou usuário inexistente → 401 INVALID_CREDENTIALS', async () => {
    await service.createUser({ username: 'maria', password: 'senha-forte', role: 'USER' });

    await expect(service.login({ username: 'maria', password: 'errada' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('[F5-15] refresh rotaciona: novo par válido e refresh antigo revogado', async () => {
    await service.createUser({ username: 'maria', password: 'senha-forte', role: 'USER' });
    const first = await service.login({ username: 'maria', password: 'senha-forte' });

    const second = await service.refresh({ refreshToken: first.refreshToken });
    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
    });
  });

  test('[F5-16] refresh com token expirado/desconhecido → 401 REFRESH_INVALID', async () => {
    await service.createUser({ username: 'maria', password: 'senha-forte', role: 'USER' });
    const session = await service.login({ username: 'maria', password: 'senha-forte' });

    await expect(service.refresh({ refreshToken: 'deadbeef' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_INVALID',
    });

    clock.ms += 3601 * 1000;
    await expect(service.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
    });
  });

  test('[F5-17] logout revoga o refresh token', async () => {
    await service.createUser({ username: 'maria', password: 'senha-forte', role: 'USER' });
    const session = await service.login({ username: 'maria', password: 'senha-forte' });

    await expect(service.logout({ refreshToken: session.refreshToken })).resolves.toEqual({
      loggedOut: true,
    });
    await expect(service.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
    });
  });
});

describe('authService — TOTP e elevação', () => {
  let service;
  let persistence;
  let clock;

  beforeEach(async () => {
    ({ service, persistence, clock } = createService());
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  test('[F5-18] setupTotp + confirmTotp ativam TOTP (segredo criptografado no banco)', async () => {
    const user = await service.createUser({ username: 'maria', password: 'x', role: 'USER' });
    const { secret, otpauthUri, qrCodeDataUrl } = await service.setupTotp(user.id);

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toContain('otpauth://totp/');
    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const rawUser = await persistence.getUserById(user.id);
    expect(rawUser.totp_pending_secret_encrypted).toBeTruthy();
    expect(rawUser.totp_pending_secret_encrypted).not.toContain(secret);
    expect(rawUser.totp_secret_encrypted).toBeNull();
    expect(rawUser.totp_enabled).toBe(0);

    const code = generateTotpCode(secret, { now: () => clock.ms });
    await expect(service.confirmTotp(user.id, code)).resolves.toEqual({ totpEnabled: true });

    const confirmed = await persistence.getUserById(user.id);
    expect(confirmed.totp_enabled).toBe(1);
    expect(confirmed.totp_secret_encrypted).toBeTruthy();
    expect(confirmed.totp_pending_secret_encrypted).toBeNull();
  });

  test('[F5-19] elevate com código válido retorna elevationToken de 15 min', async () => {
    const { user, secret } = await createEnabledTotpUser(service, clock);
    const code = generateTotpCode(secret, { now: () => clock.ms });

    const elevation = await service.elevate(user.id, code);
    expect(elevation.expiresInSeconds).toBe(900);

    const claims = service.verifyElevationToken(elevation.elevationToken, user.id);
    expect(claims.kind).toBe('elevation');
  });

  test('[F5-20] elevate com código inválido → 401 INVALID_TOTP_CODE', async () => {
    const { user } = await createEnabledTotpUser(service, clock);
    await expect(service.elevate(user.id, '000000')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_TOTP_CODE',
    });
  });

  test('[F5-21] elevate sem TOTP configurado → 400 TOTP_NOT_CONFIGURED', async () => {
    const user = await service.createUser({ username: 'novato', password: 'x', role: 'USER' });
    await expect(service.elevate(user.id, '123456')).rejects.toMatchObject({
      statusCode: 400,
      code: 'TOTP_NOT_CONFIGURED',
    });
  });

  test('[F5-22] verifyElevationToken rejeita token de outro usuário e token expirado', async () => {
    const { user, secret } = await createEnabledTotpUser(service, clock);
    const code = generateTotpCode(secret, { now: () => clock.ms });
    const { elevationToken } = await service.elevate(user.id, code);

    expect(() => service.verifyElevationToken(elevationToken, 'outro-user')).toThrow(AuthError);

    clock.ms += 901 * 1000;
    expect(() => service.verifyElevationToken(elevationToken, user.id)).toThrow(AuthError);
  });

  test('verifyAccessToken rejeita elevation token no lugar de access', async () => {
    const { user, secret } = await createEnabledTotpUser(service, clock);
    const code = generateTotpCode(secret, { now: () => clock.ms });
    const { elevationToken } = await service.elevate(user.id, code);

    expect(() => service.verifyAccessToken(elevationToken)).toThrow(
      expect.objectContaining({ code: 'TOKEN_INVALID' }),
    );
  });
});
