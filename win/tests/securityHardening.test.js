const fs = require('fs/promises');
const path = require('path');
const Database = require('better-sqlite3');
const { createAuthService } = require('../src/modules/authService');
const { generateTotpCode } = require('../src/modules/totpService');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { deleteOutputFile } = require('../src/modules/linker');
const { readJsonBody, MAX_JSON_BODY_BYTES } = require('../src/modules/appServer');
const { MAX_TOTAL_BYTES } = require('../src/modules/stagingUpload');
const { createTempDir } = require('./helpers/fixtures');

const TEST_KEY = Buffer.alloc(32, 3).toString('hex');
const JWT_SECRET = 'hardening-secret';
const PASSWORD = 'senha-original';

function createService({ nowMs = 1_700_000_000_000 } = {}) {
  const clock = { ms: nowMs };
  const persistence = createPersistenceAdapter('memory');
  const service = createAuthService({
    persistence,
    cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    jwtSecret: JWT_SECRET,
    now: () => clock.ms,
  });
  return { service, persistence, clock };
}

describe('authService — troca de authenticator', () => {
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

  async function createUserWithTotp() {
    const user = await service.createUser({
      username: 'maria',
      password: PASSWORD,
      role: 'ADM',
    });
    const { secret } = await service.setupTotp(user.id);
    await service.confirmTotp(user.id, generateTotpCode(secret, { now: () => clock.ms }));
    return { user, secret };
  }

  test('[F8-130] setupTotp com TOTP ativo e sem senha → 403 TOTP_REENROLL_DENIED', async () => {
    const { user, secret } = await createUserWithTotp();

    await expect(service.setupTotp(user.id)).rejects.toMatchObject({
      statusCode: 403,
      code: 'TOTP_REENROLL_DENIED',
    });

    // O authenticator original continua válido — nada foi rotacionado.
    const elevation = await service.elevate(
      user.id,
      generateTotpCode(secret, { now: () => clock.ms }),
    );
    expect(elevation.elevationToken).toBeTruthy();
  });

  test('setupTotp com senha errada é recusado', async () => {
    const { user } = await createUserWithTotp();

    await expect(service.setupTotp(user.id, { password: 'senha-errada' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'TOTP_REENROLL_DENIED',
    });
  });

  test('[F8-131] setupTotp com senha correta emite pendente sem derrubar o ativo', async () => {
    const { user, secret } = await createUserWithTotp();

    const renewed = await service.setupTotp(user.id, { password: PASSWORD });
    expect(renewed.secret).not.toBe(secret);

    // Enquanto o confirm não vier, o authenticator antigo continua elevando.
    const stillActive = await service.elevate(
      user.id,
      generateTotpCode(secret, { now: () => clock.ms }),
    );
    expect(stillActive.elevationToken).toBeTruthy();

    await expect(
      service.elevate(user.id, generateTotpCode(renewed.secret, { now: () => clock.ms })),
    ).rejects.toMatchObject({ code: 'INVALID_TOTP_CODE' });

    await service.confirmTotp(user.id, generateTotpCode(renewed.secret, { now: () => clock.ms }));
    const elevation = await service.elevate(
      user.id,
      generateTotpCode(renewed.secret, { now: () => clock.ms }),
    );
    expect(elevation.elevationToken).toBeTruthy();

    await expect(
      service.elevate(user.id, generateTotpCode(secret, { now: () => clock.ms })),
    ).rejects.toMatchObject({ code: 'INVALID_TOTP_CODE' });
  });

  test('primeiro setupTotp continua dispensando senha', async () => {
    const user = await service.createUser({ username: 'novo', password: PASSWORD, role: 'USER' });
    await expect(service.setupTotp(user.id)).resolves.toMatchObject({
      secret: expect.any(String),
    });
  });

  test('[F8-132] segredo pendente (setup sem confirm) não permite elevate', async () => {
    const user = await service.createUser({ username: 'pendente', password: PASSWORD, role: 'USER' });
    const { secret } = await service.setupTotp(user.id);

    await expect(
      service.elevate(user.id, generateTotpCode(secret, { now: () => clock.ms })),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'TOTP_NOT_CONFIGURED',
    });
  });

  test('[F8-133] qrCodeDataUrl é data URL PNG válido gerado localmente', async () => {
    const user = await service.createUser({ username: 'qr', password: PASSWORD, role: 'USER' });
    const { qrCodeDataUrl, otpauthUri } = await service.setupTotp(user.id);

    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(otpauthUri).toContain('otpauth://totp/');
    const payload = qrCodeDataUrl.slice('data:image/png;base64,'.length);
    expect(Buffer.from(payload, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test('[F8-134] totp_secret_encrypted no banco difere do segredo em claro', async () => {
    const user = await service.createUser({ username: 'cipher', password: PASSWORD, role: 'USER' });
    const { secret } = await service.setupTotp(user.id);
    await service.confirmTotp(user.id, generateTotpCode(secret, { now: () => clock.ms }));

    const raw = await persistence.getUserById(user.id);
    expect(raw.totp_secret_encrypted).toBeTruthy();
    expect(raw.totp_secret_encrypted).not.toContain(secret);
    expect(raw.totp_pending_secret_encrypted).toBeNull();
  });
});

describe('authService — login defensivo', () => {
  let service;
  let persistence;

  beforeEach(async () => {
    ({ service, persistence } = createService());
    await persistence.init();
    await service.createUser({ username: 'maria', password: PASSWORD, role: 'ADM' });
  });

  afterEach(async () => {
    await persistence.close();
  });

  test.each([
    ['objeto', { $ne: null }],
    ['número', 12345],
    ['array', ['a']],
    ['nulo', null],
  ])('senha do tipo %s vira 401 e não 500', async (_label, password) => {
    await expect(service.login({ username: 'maria', password })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('username não-string vira 401', async () => {
    await expect(
      service.login({ username: { $ne: null }, password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('senha acima do limite é rejeitada sem rodar scrypt', async () => {
    await expect(
      service.login({ username: 'maria', password: 'x'.repeat(5000) }),
    ).rejects.toMatchObject({ statusCode: 401 });

    await expect(
      service.createUser({ username: 'gigante', password: 'x'.repeat(5000), role: 'USER' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_USER_DATA' });
  });

  test('usuário inexistente custa o mesmo que senha errada (sem oráculo de tempo)', async () => {
    async function measure(username) {
      const start = process.hrtime.bigint();
      await service.login({ username, password: 'errada' }).catch(() => {});
      return Number(process.hrtime.bigint() - start) / 1e6;
    }

    await measure('maria');

    let known = 0;
    let unknown = 0;
    for (let i = 0; i < 5; i += 1) {
      known += await measure('maria');
      unknown += await measure('fantasma');
    }

    // Antes do fix o caminho "usuário inexistente" retornava sem rodar scrypt
    // (~0.02ms contra ~30ms), o que enumerava contas válidas.
    expect(unknown / 5).toBeGreaterThan((known / 5) * 0.5);
  });
});

describe('appServer — readJsonBody', () => {
  function fakeRequest(chunks) {
    let destroyed = false;
    return {
      get destroyed() {
        return destroyed;
      },
      destroy() {
        destroyed = true;
      },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield Buffer.from(chunk);
        }
      },
    };
  }

  test('aborta com 413 quando o corpo excede o teto', async () => {
    const req = fakeRequest(['x'.repeat(40), 'y'.repeat(40)]);

    await expect(readJsonBody(req, { maxBytes: 50 })).rejects.toMatchObject({
      statusCode: 413,
      message: 'Request body too large',
    });
    expect(req.destroyed).toBe(true);
  });

  test('corpo dentro do teto é parseado normalmente', async () => {
    const req = fakeRequest(['{"files"', ':[]}']);
    await expect(readJsonBody(req, { maxBytes: 50 })).resolves.toEqual({ files: [] });
  });

  test('teto padrão acomoda o maior upload permitido em base64', () => {
    // stagingUpload aceita até MAX_TOTAL_BYTES; base64 infla o payload em 4/3.
    expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(Math.ceil((MAX_TOTAL_BYTES * 4) / 3));
  });
});

describe('sqlitePersistence — migração de bancos legados', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('sqlite-legacy-');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function seedLegacyDb(dbPath, { withJobs }) {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE llm_models (
      id TEXT PRIMARY KEY, name TEXT, provider TEXT, model_id TEXT,
      base_url TEXT, token_encrypted TEXT, is_default INTEGER,
      created_at TEXT, updated_at TEXT);`);
    db.prepare(
      `INSERT INTO llm_models VALUES ('m1','Legado','ollama','llama3',NULL,NULL,1,'2026-01-01','2026-01-01')`,
    ).run();
    if (withJobs) {
      db.exec(`CREATE TABLE llm_jobs (
        id TEXT PRIMARY KEY, llm_model_id TEXT, source_file TEXT, source_type TEXT,
        prompt_template TEXT, status TEXT, response_file TEXT, summary TEXT,
        error_message TEXT, created_at TEXT, completed_at TEXT);`);
      db.prepare(
        `INSERT INTO llm_jobs VALUES ('j1','m1','a.csv','csv',NULL,'completed',NULL,NULL,NULL,'2026-01-01',NULL)`,
      ).run();
    }
    db.close();
  }

  function insertAdmin(persistence, id) {
    persistence.db
      .prepare(
        `INSERT INTO users
          (id, username, password_hash, role, totp_enabled, subscription_status, created_at, updated_at)
          VALUES (?, 'admin', 'x', 'ADM', 0, 'active', '2026-01-01', '2026-01-01')`,
      )
      .run(id);
  }

  test('banco da Fase 2 sem tabela llm_jobs inicializa sem erro', async () => {
    const dbPath = path.join(tempDir, 'legacy-no-jobs.db');
    seedLegacyDb(dbPath, { withJobs: false });

    const persistence = createPersistenceAdapter('sqlite', { dbPath });
    await expect(persistence.init()).resolves.toBeUndefined();
    await persistence.close();
  });

  test('models e jobs órfãos são atribuídos ao primeiro ADM', async () => {
    const dbPath = path.join(tempDir, 'legacy-with-jobs.db');
    seedLegacyDb(dbPath, { withJobs: true });

    // Primeiro boot: renomeia as tabelas legadas; ainda não existe ADM.
    let persistence = createPersistenceAdapter('sqlite', { dbPath });
    await persistence.init();
    insertAdmin(persistence, 'adm-1');
    await persistence.close();

    // Segundo boot: com ADM presente, os órfãos são migrados.
    persistence = createPersistenceAdapter('sqlite', { dbPath });
    await persistence.init();

    const models = await persistence.listLlmModels({ userId: 'adm-1' });
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Legado');

    const jobs = await persistence.listLlmJobs({ userId: 'adm-1' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceFile).toBe('a.csv');

    await persistence.close();
  });
});

describe('linker — deleteOutputFile', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('linker-delete-');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('remove o caminho validado, não o basename na raiz', async () => {
    await fs.mkdir(path.join(outputDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'report.csv'), 'raiz', 'utf8');
    await fs.writeFile(path.join(outputDir, 'sub', 'report.csv'), 'aninhado', 'utf8');

    await deleteOutputFile(outputDir, path.join('sub', 'report.csv'));

    await expect(fs.readFile(path.join(outputDir, 'report.csv'), 'utf8')).resolves.toBe('raiz');
    await expect(fs.access(path.join(outputDir, 'sub', 'report.csv'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('path traversal continua bloqueado', async () => {
    await expect(deleteOutputFile(outputDir, '../secret.txt')).rejects.toMatchObject({
      name: 'LinkerError',
    });
  });
});
