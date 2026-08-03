const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createAuthService, isSubscriptionActive } = require('../src/modules/authService');
const { createLlmModelService } = require('../src/modules/llmModelService');

const TEST_KEY = Buffer.alloc(32, 21).toString('hex');
const JWT_SECRET = 'f6-jwt';

function createAuth(nowMs = Date.now()) {
  const clock = { ms: nowMs };
  const persistence = createPersistenceAdapter('memory');
  const authService = createAuthService({
    persistence,
    cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    jwtSecret: JWT_SECRET,
    now: () => clock.ms,
  });
  return { persistence, authService, clock };
}

describe('Fase 6 — multi-tenant e assinatura', () => {
  let persistence;
  let authService;
  let clock;

  beforeEach(async () => {
    ({ persistence, authService, clock } = createAuth());
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  test('[F6-01] createLlmModel exige userId e persiste user_id', async () => {
    const user = await authService.createUser({
      username: 'a',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    await expect(persistence.createLlmModel({ name: 'M', provider: 'ollama', modelId: 'm' })).rejects.toThrow(
      /userId/,
    );
    const model = await persistence.createLlmModel({
      userId: user.id,
      name: 'M',
      provider: 'ollama',
      modelId: 'm',
    });
    expect(model.userId).toBe(user.id);
  });

  test('[F6-02] listLlmModels(userA) não retorna models de userB', async () => {
    const a = await authService.createUser({
      username: 'a',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const b = await authService.createUser({
      username: 'b',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    await persistence.createLlmModel({
      userId: a.id,
      name: 'A',
      provider: 'ollama',
      modelId: 'a',
    });
    await persistence.createLlmModel({
      userId: b.id,
      name: 'B',
      provider: 'ollama',
      modelId: 'b',
    });
    const listed = await persistence.listLlmModels({ userId: a.id });
    expect(listed.map((m) => m.name)).toEqual(['A']);
  });

  test('[F6-03] get/update/delete de model de outro user → null', async () => {
    const a = await authService.createUser({
      username: 'a',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const b = await authService.createUser({
      username: 'b',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const model = await persistence.createLlmModel({
      userId: a.id,
      name: 'A',
      provider: 'ollama',
      modelId: 'a',
    });
    expect(await persistence.getLlmModel(model.id, b.id)).toBeNull();
    expect(await persistence.updateLlmModel(model.id, { name: 'Hijack' }, b.id)).toBeNull();
    expect(await persistence.deleteLlmModel(model.id, b.id)).toBe(false);
    expect((await persistence.getLlmModel(model.id, a.id)).name).toBe('A');
  });

  test('[F6-04] is_default independente por usuário', async () => {
    const a = await authService.createUser({
      username: 'a',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const b = await authService.createUser({
      username: 'b',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    await persistence.createLlmModel({
      userId: a.id,
      name: 'A1',
      provider: 'ollama',
      modelId: 'a1',
      isDefault: true,
    });
    const bDefault = await persistence.createLlmModel({
      userId: b.id,
      name: 'B1',
      provider: 'ollama',
      modelId: 'b1',
      isDefault: true,
    });
    const aModels = await persistence.listLlmModels({ userId: a.id });
    expect(aModels[0].isDefault).toBe(true);
    expect(bDefault.isDefault).toBe(true);
  });

  test('[F6-05] jobs isolados por userId', async () => {
    const a = await authService.createUser({
      username: 'a',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const b = await authService.createUser({
      username: 'b',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const model = await persistence.createLlmModel({
      userId: a.id,
      name: 'A',
      provider: 'ollama',
      modelId: 'a',
    });
    await persistence.createLlmJob({
      userId: a.id,
      llmModelId: model.id,
      sourceFile: 'a.txt',
      sourceType: 'txt',
      status: 'completed',
    });
    expect(await persistence.listLlmJobs({ userId: b.id })).toEqual([]);
    expect(await persistence.listLlmJobs({ userId: a.id })).toHaveLength(1);
  });

  test('[F6-06] isSubscriptionActive: ADM sempre true', async () => {
    const adm = await authService.createUser({ username: 'adm', password: 'x', role: 'ADM' });
    expect(isSubscriptionActive(adm)).toBe(true);
  });

  test('[F6-07] USER active + expiresAt futuro → true', async () => {
    const user = await authService.createUser({
      username: 'u',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    expect(authService.isSubscriptionActive(user)).toBe(true);
  });

  test('[F6-08] USER expired / none / passado → false', async () => {
    const none = await authService.createUser({ username: 'n', password: 'x', role: 'USER' });
    expect(authService.isSubscriptionActive(none)).toBe(false);

    const expired = await authService.createUser({
      username: 'e',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms - 1000).toISOString(),
      subscriptionStatus: 'expired',
    });
    expect(authService.isSubscriptionActive(expired)).toBe(false);
  });

  test('[F6-09] renewSubscription atualiza expiresAt e status active', async () => {
    const user = await authService.createUser({ username: 'u', password: 'x', role: 'USER' });
    const renewed = await authService.renewSubscription(user.id, { months: 1 });
    expect(renewed.subscriptionStatus).toBe('active');
    expect(new Date(renewed.subscriptionExpiresAt).getTime()).toBeGreaterThan(clock.ms);
  });

  test('[F6-14] createPersistenceAdapter(mysql) retorna MySQL adapter', () => {
    const adapter = createPersistenceAdapter('mysql', { database: 'test' });
    expect(adapter.constructor.name).toBe('MysqlPersistenceAdapter');
  });

  test('[F6-15] createPersistenceAdapter tipo desconhecido → throw', () => {
    expect(() => createPersistenceAdapter('oracle')).toThrow(/Unknown persistence/);
  });

  test('[F6-12] USER lista só próprios models via service', async () => {
    const user = await authService.createUser({
      username: 'u',
      password: 'x',
      role: 'USER',
      subscriptionExpiresAt: new Date(clock.ms + 86400000).toISOString(),
    });
    const service = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });
    await service.create({ name: 'Mine', provider: 'ollama', modelId: 'm' }, user.id);
    const listed = await service.list({}, user.id);
    expect(listed).toHaveLength(1);
  });
});

describe('Fase 6 — migração SQLite [F6-16]', () => {
  const Database = require('better-sqlite3');
  const fs = require('fs/promises');
  const path = require('path');
  const { createTempDir } = require('./helpers/fixtures');

  let tempDir;
  let dbPath;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('[F6-16] init SQLite migra órfãos para ADM e preenche subscription', async () => {
    tempDir = await createTempDir('f6-migrate-');
    dbPath = path.join(tempDir, 'legacy.db');

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        totp_secret_encrypted TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE llm_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        base_url TEXT,
        token_encrypted TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE llm_jobs (
        id TEXT PRIMARY KEY,
        llm_model_id TEXT NOT NULL,
        source_file TEXT NOT NULL,
        source_type TEXT NOT NULL,
        prompt_template TEXT,
        status TEXT NOT NULL,
        response_file TEXT,
        summary TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    legacy
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
         VALUES ('adm-1', 'admin', 'hash', 'ADM', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
         VALUES ('user-1', 'maria', 'hash', 'USER', 0, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO llm_models
         (id, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at)
         VALUES ('model-1', 'Legacy', 'ollama', 'llama3', NULL, NULL, 1, '2020-01-03T00:00:00.000Z', '2020-01-03T00:00:00.000Z')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO llm_jobs
         (id, llm_model_id, source_file, source_type, status, created_at)
         VALUES ('job-1', 'model-1', 'a.txt', 'txt', 'completed', '2020-01-04T00:00:00.000Z')`,
      )
      .run();
    legacy.close();

    const persistence = createPersistenceAdapter('sqlite', { dbPath });
    await persistence.init();

    const models = await persistence.listLlmModels({ userId: 'adm-1' });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('model-1');
    expect(await persistence.listLlmModels({ userId: 'user-1' })).toEqual([]);

    const jobs = await persistence.listLlmJobs({ userId: 'adm-1' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-1');

    const adm = await persistence.getUserById('adm-1');
    expect(adm.subscription_status).toBe('active');
    expect(adm.subscription_expires_at).toBeNull();

    const user = await persistence.getUserById('user-1');
    expect(user.subscription_status).toBe('none');

    await persistence.close();
  });
});
