const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { createAppServer } = require('../src/modules/appServer');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const { createAuthService } = require('../src/modules/authService');
const { generateTotpCode } = require('../src/modules/totpService');
const phase1Api = require('../src/api');

const TEST_KEY = Buffer.alloc(32, 5).toString('hex');
const JWT_SECRET = 'integration-jwt-secret';
const ADMIN_PASSWORD = 'admin-pass';
const USER_PASSWORD = 'user-pass';

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      url,
      {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ statusCode: res.statusCode, body: raw, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

describe('API REST — autenticação e guards (integração)', () => {
  let server;
  let persistence;
  let authService;
  let outputDir;
  let staticDir;
  let logsDir;
  let stagingDir;
  let adminUser;
  let regularUser;
  let regularUserTotpSecret;

  async function loginAs(username, password) {
    const res = await request(`${server.url}/api/v1/auth/login`, { method: 'POST' }, {
      username,
      password,
    });
    expect(res.statusCode).toBe(200);
    return res.json;
  }

  async function elevate(session, secret) {
    const res = await request(
      `${server.url}/api/v1/auth/elevate`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
      { code: generateTotpCode(secret) },
    );
    expect(res.statusCode).toBe(200);
    return res.json.elevationToken;
  }

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-api-out-'));
    staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-api-static-'));
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-api-logs-'));
    stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-api-staging-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html></html>');

    persistence = createPersistenceAdapter('memory');
    await persistence.init();

    const cryptoAdapter = createCryptoAdapter({ secret: TEST_KEY });
    authService = createAuthService({
      persistence,
      cryptoAdapter,
      jwtSecret: JWT_SECRET,
    });

    adminUser = await authService.createUser({
      username: 'admin',
      password: ADMIN_PASSWORD,
      role: 'ADM',
    });
    regularUser = await authService.createUser({
      username: 'maria',
      password: USER_PASSWORD,
      role: 'USER',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      subscriptionPlan: 'monthly',
    });

    const setup = await authService.setupTotp(regularUser.id);
    regularUserTotpSecret = setup.secret;
    await authService.confirmTotp(regularUser.id, generateTotpCode(setup.secret));

    const adminSetup = await authService.setupTotp(adminUser.id);
    await authService.confirmTotp(adminUser.id, generateTotpCode(adminSetup.secret));
    adminUser.totpSecret = adminSetup.secret;

    const llmModelService = createLlmModelService({ persistence, cryptoAdapter });
    const llmProcessService = createLlmProcessService({
      persistence,
      modelService: llmModelService,
      outputDir,
      baseUrl: 'http://127.0.0.1:0',
      createLlmAdapterFn: () => ({ complete: async () => ({ content: '{}' }) }),
    });

    server = await createAppServer({
      port: 0,
      outputDir,
      staticDir,
      logsDir,
      stagingDir,
      phase1Api,
      llmModelService,
      llmProcessService,
      authService,
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    await persistence.close();
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(staticDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
    await fs.rm(stagingDir, { recursive: true, force: true });
  });

  test('[F5-23] POST /api/v1/auth/login → 200 com tokens; senha errada → 401', async () => {
    const session = await loginAs('admin', ADMIN_PASSWORD);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.user).toMatchObject({ username: 'admin', role: 'ADM' });

    const bad = await request(`${server.url}/api/v1/auth/login`, { method: 'POST' }, {
      username: 'admin',
      password: 'errada',
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json.code).toBe('INVALID_CREDENTIALS');
  });

  test('[F5-24] rota protegida sem Authorization → 401', async () => {
    const res = await request(`${server.url}/api/v1/files`);
    expect(res.statusCode).toBe(401);
    expect(res.json.code).toBe('AUTH_REQUIRED');
  });

  test('[F5-25] access válido sem elevação → 403 ELEVATION_REQUIRED', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const res = await request(`${server.url}/api/v1/files`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('ELEVATION_REQUIRED');
  });

  test('[F5-26] fluxo completo: login → elevate → POST /api/v1/input/stage → 201', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const elevationToken = await elevate(session, regularUserTotpSecret);

    const res = await request(
      `${server.url}/api/v1/input/stage`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Elevation-Token': elevationToken,
        },
      },
      { files: [{ name: 'demo.xls', data: Buffer.from('col1;col2\n1;2\n').toString('base64') }] },
    );
    expect(res.statusCode).toBe(201);
  });

  test('POST /api/v1/auth/totp/setup não troca o authenticator só com o access token', async () => {
    const session = await loginAs('maria', USER_PASSWORD);

    const denied = await request(
      `${server.url}/api/v1/auth/totp/setup`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
      null,
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json.code).toBe('TOTP_REENROLL_DENIED');

    // O authenticator original segue funcionando para elevar.
    const elevationToken = await elevate(session, regularUserTotpSecret);
    expect(elevationToken).toBeTruthy();

    const allowed = await request(
      `${server.url}/api/v1/auth/totp/setup`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
      { password: USER_PASSWORD },
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json.secret).not.toBe(regularUserTotpSecret);

    // Setup abandonado (sem confirm) não derruba o authenticator ativo.
    const stillWorks = await elevate(session, regularUserTotpSecret);
    expect(stillWorks).toBeTruthy();
  });

  test('[F8-135] elevation token do usuário A em requisição do usuário B → 403', async () => {
    const maria = await loginAs('maria', USER_PASSWORD);
    const admin = await loginAs('admin', ADMIN_PASSWORD);
    const mariaElevation = await elevate(maria, regularUserTotpSecret);

    const res = await request(`${server.url}/api/v1/files`, {
      headers: {
        Authorization: `Bearer ${admin.accessToken}`,
        'X-Elevation-Token': mariaElevation,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('ELEVATION_REQUIRED');
  });

  test('[F8-136] nenhuma resposta de auth contém totp_secret_encrypted', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const me = await request(`${server.url}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json)).not.toMatch(/totp_secret_encrypted|totp_pending_secret/i);

    const setup = await request(
      `${server.url}/api/v1/auth/totp/setup`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
      { password: USER_PASSWORD },
    );
    expect(setup.statusCode).toBe(200);
    expect(JSON.stringify(setup.json)).not.toMatch(/totp_secret_encrypted|totp_pending_secret/i);
    expect(setup.json).toEqual(
      expect.objectContaining({
        secret: expect.any(String),
        otpauthUri: expect.any(String),
        qrCodeDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    );
  });

  test('[F5-27] USER em rota ADM (GET /api/v1/logs) → 403 FORBIDDEN_ROLE', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const res = await request(`${server.url}/api/v1/logs`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('FORBIDDEN_ROLE');
  });

  test('[F5-28] USER em rota de arquivos com elevação → 200', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const elevationToken = await elevate(session, regularUserTotpSecret);

    const res = await request(`${server.url}/api/v1/files`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Elevation-Token': elevationToken,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json.files)).toBe(true);
  });

  test('[F5-29] POST /api/v1/auth/refresh renova sessão; refresh revogado → 401', async () => {
    const session = await loginAs('maria', USER_PASSWORD);

    const renewed = await request(`${server.url}/api/v1/auth/refresh`, { method: 'POST' }, {
      refreshToken: session.refreshToken,
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json.accessToken).toBeTruthy();

    const reused = await request(`${server.url}/api/v1/auth/refresh`, { method: 'POST' }, {
      refreshToken: session.refreshToken,
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json.code).toBe('REFRESH_INVALID');
  });

  test('[F5-30] GET /open/:name aceita tokens via query string', async () => {
    const userOut = path.join(outputDir, regularUser.id);
    await fs.mkdir(userOut, { recursive: true });
    await fs.writeFile(path.join(userOut, 'result.csv'), 'a;b\n1;2\n');
    const session = await loginAs('maria', USER_PASSWORD);
    const elevationToken = await elevate(session, regularUserTotpSecret);

    const denied = await request(`${server.url}/open/result.csv`);
    expect(denied.statusCode).toBe(401);

    const query = new URLSearchParams({
      access_token: session.accessToken,
      elevation_token: elevationToken,
    });
    const allowed = await request(`${server.url}/open/result.csv?${query}`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain('a;b');
  });

  test('[F6-17] staging/output isolados por usuário no filesystem', async () => {
    const mariaSession = await loginAs('maria', USER_PASSWORD);
    const mariaElevation = await elevate(mariaSession, regularUserTotpSecret);
    const adminSession = await loginAs('admin', ADMIN_PASSWORD);
    const adminElevation = await elevate(adminSession, adminUser.totpSecret);

    const pdfBase64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');

    const stageMaria = await request(
      `${server.url}/api/v1/input/stage`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mariaSession.accessToken}`,
          'X-Elevation-Token': mariaElevation,
        },
      },
      { files: [{ name: 'secret-a.pdf', data: pdfBase64 }] },
    );
    expect(stageMaria.statusCode).toBe(201);

    const stageAdmin = await request(
      `${server.url}/api/v1/input/stage`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminSession.accessToken}`,
          'X-Elevation-Token': adminElevation,
        },
      },
      { files: [{ name: 'secret-b.pdf', data: pdfBase64 }] },
    );
    expect(stageAdmin.statusCode).toBe(201);

    const mariaStagingEntries = await fs.readdir(path.join(stagingDir, regularUser.id));
    const adminStagingEntries = await fs.readdir(path.join(stagingDir, adminUser.id));
    expect(mariaStagingEntries.length).toBeGreaterThan(0);
    expect(adminStagingEntries.length).toBeGreaterThan(0);

    await fs.mkdir(path.join(outputDir, regularUser.id), { recursive: true });
    await fs.writeFile(path.join(outputDir, regularUser.id, 'only-maria.csv'), 'maria\n');
    await fs.mkdir(path.join(outputDir, adminUser.id), { recursive: true });
    await fs.writeFile(path.join(outputDir, adminUser.id, 'only-admin.csv'), 'admin\n');

    const mariaFiles = await request(`${server.url}/api/v1/files`, {
      headers: {
        Authorization: `Bearer ${mariaSession.accessToken}`,
        'X-Elevation-Token': mariaElevation,
      },
    });
    expect(mariaFiles.statusCode).toBe(200);
    const mariaNames = mariaFiles.json.files.map((f) => f.name);
    expect(mariaNames).toContain('only-maria.csv');
    expect(mariaNames).not.toContain('only-admin.csv');

    const adminFiles = await request(`${server.url}/api/v1/files`, {
      headers: {
        Authorization: `Bearer ${adminSession.accessToken}`,
        'X-Elevation-Token': adminElevation,
      },
    });
    expect(adminFiles.statusCode).toBe(200);
    const adminNames = adminFiles.json.files.map((f) => f.name);
    expect(adminNames).toContain('only-admin.csv');
    expect(adminNames).not.toContain('only-maria.csv');

    const crossOpen = await request(
      `${server.url}/open/only-admin.csv?${new URLSearchParams({
        access_token: mariaSession.accessToken,
        elevation_token: mariaElevation,
      })}`,
    );
    expect(crossOpen.statusCode).toBe(404);
  });

  test('[F5-31] rotas públicas seguem acessíveis sem token', async () => {
    const home = await request(`${server.url}/`);
    expect(home.statusCode).toBe(200);

    const login = await request(`${server.url}/api/v1/auth/login`, { method: 'POST' }, {});
    expect(login.statusCode).toBe(401); // rota alcançável; credenciais vazias apenas falham
  });

  test('[F5-32] POST /api/v1/auth/users por USER → 403; por ADM → 201', async () => {
    const userSession = await loginAs('maria', USER_PASSWORD);
    const denied = await request(
      `${server.url}/api/v1/auth/users`,
      { method: 'POST', headers: { Authorization: `Bearer ${userSession.accessToken}` } },
      { username: 'novo', password: 'x', role: 'USER' },
    );
    expect(denied.statusCode).toBe(403);

    const adminSession = await loginAs('admin', ADMIN_PASSWORD);
    const created = await request(
      `${server.url}/api/v1/auth/users`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminSession.accessToken}` } },
      { username: 'novo', password: 'senha-nova', role: 'USER' },
    );
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({ username: 'novo', role: 'USER' });
  });

  test('GET /api/v1/auth/me retorna sessão e estado de elevação', async () => {
    const session = await loginAs('maria', USER_PASSWORD);

    const plain = await request(`${server.url}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.json.user).toMatchObject({ username: 'maria', role: 'USER', totpEnabled: true });
    expect(plain.json.elevated).toBe(false);
    expect(plain.json.subscription.active).toBe(true);
    expect(plain.json.accessTtlSeconds).toBe(900);

    const elevationToken = await elevate(session, regularUserTotpSecret);
    const elevated = await request(`${server.url}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Elevation-Token': elevationToken,
      },
    });
    expect(elevated.json.elevated).toBe(true);
    expect(elevated.json.elevationExpiresAt).toBeTruthy();
  });

  test('[F6-10] USER expirado: login 200; GET /files → 403 SUBSCRIPTION_EXPIRED', async () => {
    const expired = await authService.createUser({
      username: 'expirado',
      password: 'pass',
      role: 'USER',
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const setup = await authService.setupTotp(expired.id);
    await authService.confirmTotp(expired.id, require('../src/modules/totpService').generateTotpCode(setup.secret));

    const session = await loginAs('expirado', 'pass');
    expect(session.accessToken).toBeTruthy();

    const res = await request(`${server.url}/api/v1/files`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  test('[F6-11] após PATCH renew, arquivos voltam a funcionar', async () => {
    const expired = await authService.createUser({
      username: 'renovar',
      password: 'pass',
      role: 'USER',
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const setup = await authService.setupTotp(expired.id);
    const { generateTotpCode } = require('../src/modules/totpService');
    await authService.confirmTotp(expired.id, generateTotpCode(setup.secret));

    const adminSession = await loginAs('admin', ADMIN_PASSWORD);
    const renewed = await request(
      `${server.url}/api/v1/auth/users/${expired.id}/subscription`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${adminSession.accessToken}` } },
      { months: 1, plan: 'monthly' },
    );
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json.subscriptionStatus).toBe('active');

    const session = await loginAs('renovar', 'pass');
    const elevationToken = await elevate(session, setup.secret);
    const files = await request(`${server.url}/api/v1/files`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Elevation-Token': elevationToken,
      },
    });
    expect(files.statusCode).toBe(200);
  });

  test('[F6-13] USER em /api/v1/logs → 403 FORBIDDEN_ROLE', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const res = await request(`${server.url}/api/v1/logs`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('FORBIDDEN_ROLE');
  });

  test('[F6-12] USER acessa GET /api/v1/llm/models (próprios) → 200', async () => {
    const session = await loginAs('maria', USER_PASSWORD);
    const elevationToken = await elevate(session, regularUserTotpSecret);
    const res = await request(`${server.url}/api/v1/llm/models`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Elevation-Token': elevationToken,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json.models)).toBe(true);
  });
});
