'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createAuthService, verifyPassword } = require('../src/modules/authService');
const { resolveDesktopPaths } = require('../desktop/desktopConfig');
const { createDesktopApp } = require('../src/desktop/createDesktopApp');
const phase1Api = require('../src/api');

const CURRENT_PASSWORD = 'admin123';
const NEW_PASSWORD = 'senhaNova456';

async function createService() {
  const persistence = createPersistenceAdapter('memory');
  await persistence.init();

  const authService = createAuthService({
    persistence,
    cryptoAdapter: createCryptoAdapter({ secret: crypto.randomBytes(32).toString('hex') }),
    jwtSecret: crypto.randomBytes(32).toString('hex'),
  });

  const user = await authService.createUser({
    username: 'admin',
    password: CURRENT_PASSWORD,
    role: 'ADM',
  });

  return { persistence, authService, user };
}

describe('authService.changePassword', () => {
  it('troca a senha e passa a aceitar apenas a nova no login', async () => {
    const { authService, user } = await createService();

    const result = await authService.changePassword(user.id, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(result.changed).toBe(true);
    await expect(
      authService.login({ username: 'admin', password: NEW_PASSWORD }),
    ).resolves.toMatchObject({ user: { username: 'admin' } });
    await expect(
      authService.login({ username: 'admin', password: CURRENT_PASSWORD }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('grava a nova senha como hash scrypt, nunca em texto claro', async () => {
    const { persistence, authService, user } = await createService();

    await authService.changePassword(user.id, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const stored = await persistence.getUserById(user.id);
    expect(stored.password_hash).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(stored.password_hash).not.toContain(NEW_PASSWORD);
    expect(verifyPassword(NEW_PASSWORD, stored.password_hash)).toBe(true);
  });

  it('rejeita quando a senha atual está errada', async () => {
    const { authService, user } = await createService();

    await expect(
      authService.changePassword(user.id, {
        currentPassword: 'errada',
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'INVALID_CURRENT_PASSWORD' });

    await expect(
      authService.login({ username: 'admin', password: CURRENT_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('exige no mínimo 8 caracteres na nova senha', async () => {
    const { authService, user } = await createService();

    await expect(
      authService.changePassword(user.id, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: 'curta12',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_TOO_SHORT' });
  });

  it('rejeita nova senha igual à atual', async () => {
    const { authService, user } = await createService();

    await expect(
      authService.changePassword(user.id, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_UNCHANGED' });
  });

  it('rejeita nova senha ausente ou de tipo inválido', async () => {
    const { authService, user } = await createService();

    for (const newPassword of [undefined, '', 42, null]) {
      await expect(
        authService.changePassword(user.id, { currentPassword: CURRENT_PASSWORD, newPassword }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('revoga as sessões antigas e devolve um par de tokens válido', async () => {
    const { authService, user } = await createService();
    const oldSession = await authService.login({
      username: 'admin',
      password: CURRENT_PASSWORD,
    });

    const result = await authService.changePassword(user.id, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(result.revokedSessions).toBeGreaterThanOrEqual(1);
    await expect(
      authService.refresh({ refreshToken: oldSession.refreshToken }),
    ).rejects.toBeDefined();
    await expect(
      authService.refresh({ refreshToken: result.refreshToken }),
    ).resolves.toMatchObject({ accessToken: expect.any(String) });
  });

  it('falha com 404 para usuário inexistente', async () => {
    const { authService } = await createService();

    await expect(
      authService.changePassword('nao-existe', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });
});

describe('POST /api/v1/auth/password', () => {
  let tmpDir;
  let app;
  let accessToken;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-pass-'));
    const paths = resolveDesktopPaths({
      userData: path.join(tmpDir, 'userData'),
      documents: path.join(tmpDir, 'Documents'),
    });

    app = createDesktopApp({
      paths,
      phase1Api,
      appSecretKey: crypto.randomBytes(32).toString('hex'),
      jwtSecret: crypto.randomBytes(32).toString('hex'),
    });
    await app.start();

    const login = await postJson('/api/v1/auth/login', {
      username: 'admin',
      password: CURRENT_PASSWORD,
    });
    accessToken = login.body.accessToken;
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DISABLE_TOTP;
    delete process.env.APP_MODE;
  });

  async function postJson(routePath, body, token = null) {
    const response = await fetch(`${app.url}${routePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it('exige sessão autenticada', async () => {
    const response = await postJson('/api/v1/auth/password', {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(401);
  });

  it('responde 403 com código quando a senha atual está errada', async () => {
    const response = await postJson(
      '/api/v1/auth/password',
      { currentPassword: 'errada', newPassword: NEW_PASSWORD },
      accessToken,
    );

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('troca a senha e devolve tokens novos utilizáveis', async () => {
    const response = await postJson(
      '/api/v1/auth/password',
      { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      accessToken,
    );

    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(true);
    expect(response.body.accessToken).toEqual(expect.any(String));

    const oldLogin = await postJson('/api/v1/auth/login', {
      username: 'admin',
      password: CURRENT_PASSWORD,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await postJson('/api/v1/auth/login', {
      username: 'admin',
      password: NEW_PASSWORD,
    });
    expect(newLogin.status).toBe(200);
  });
});
