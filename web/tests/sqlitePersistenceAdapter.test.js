const fs = require('fs/promises');
const path = require('path');
const { encrypt } = require('../src/adapters/cryptoAdapter');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createTempDir } = require('./helpers/fixtures');

const TEST_KEY = Buffer.alloc(32, 9).toString('hex');

describe('sqlitePersistence', () => {
  let tempDir;
  let dbPath;
  let persistence;

  beforeEach(async () => {
    tempDir = await createTempDir('sqlite-persist-');
    dbPath = path.join(tempDir, 'test.db');
    persistence = createPersistenceAdapter('sqlite', { dbPath });
    await persistence.init();
    persistence.db
      .prepare(
        `INSERT INTO users
        (id, username, password_hash, role, totp_enabled, subscription_status, created_at, updated_at)
        VALUES ('test-user-1', 'test-user-1', 'x', 'ADM', 0, 'active', datetime('now'), datetime('now'))`,
      )
      .run();
  });

  afterEach(async () => {
    await persistence.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[F2-01] deve criar arquivo DB e tabelas na init()', async () => {
    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  test('[F2-02] createLlmModel deve persistir e retornar DTO sem token plaintext', async () => {
    const model = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'GPT-4o Mini',
      provider: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      tokenEncrypted: 'encrypted-value',
      isDefault: false,
    });

    expect(model.id).toBeTruthy();
    expect(model.name).toBe('GPT-4o Mini');
    expect(model.hasToken).toBe(true);
    expect(model).not.toHaveProperty('token');
    expect(model).not.toHaveProperty('tokenEncrypted');
  });

  test('[F2-03] getLlmModel deve recuperar modelo por id', async () => {
    const created = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Llama 3',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    const found = await persistence.getLlmModel(created.id);
    expect(found).toEqual(created);
  });

  test('[F2-04] listLlmModels deve filtrar por provider', async () => {
    await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Ollama',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });
    await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'OpenRouter',
      provider: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      tokenEncrypted: 'enc',
      isDefault: false,
    });

    const ollamaOnly = await persistence.listLlmModels({ userId: 'test-user-1', provider: 'ollama' });
    expect(ollamaOnly).toHaveLength(1);
    expect(ollamaOnly[0].provider).toBe('ollama');
  });

  test('[F2-05] updateLlmModel deve atualizar updated_at', async () => {
    const created = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Old Name',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    const updated = await persistence.updateLlmModel(created.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test('[F2-06] deleteLlmModel deve remover registro', async () => {
    const created = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'To Delete',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    const deleted = await persistence.deleteLlmModel(created.id);
    expect(deleted).toBe(true);
    expect(await persistence.getLlmModel(created.id)).toBeNull();
  });

  test('[F2-07] is_default=true deve desmarcar outros defaults', async () => {
    const first = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'First',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: true,
    });
    const second = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Second',
      provider: 'ollama',
      modelId: 'llama3.1',
      isDefault: true,
    });

    const refreshedFirst = await persistence.getLlmModel(first.id);
    expect(refreshedFirst.isDefault).toBe(false);
    expect(second.isDefault).toBe(true);
  });

  test('[F2-08] createLlmJob / getLlmJob / listLlmJobs devem funcionar', async () => {
    const model = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Model',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    const job = await persistence.createLlmJob({
      userId: 'test-user-1',
      llmModelId: model.id,
      sourceFile: 'doc.txt',
      sourceType: 'txt',
      status: 'completed',
      summary: 'Done',
    });

    const found = await persistence.getLlmJob(job.id);
    expect(found.summary).toBe('Done');

    const jobs = await persistence.listLlmJobs({ userId: 'test-user-1', llmModelId: model.id });
    expect(jobs).toHaveLength(1);
  });

  test('[F2-09] token_encrypted deve ser diferente do token original', async () => {
    const plainToken = 'sk-or-v1-my-secret-token';
    const encrypted = encrypt(plainToken, { secret: TEST_KEY });

    const created = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Secure',
      provider: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      tokenEncrypted: encrypted,
      isDefault: false,
    });

    const row = persistence.db
      .prepare('SELECT token_encrypted FROM llm_models WHERE id = ?')
      .get(created.id);

    expect(row.token_encrypted).toBe(encrypted);
    expect(row.token_encrypted).not.toBe(plainToken);
  });

  test('[F2-10] close() deve permitir reabrir o mesmo dbPath', async () => {
    await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Persist',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    await persistence.close();

    const reopened = createPersistenceAdapter('sqlite', { dbPath });
    await reopened.init();
    const models = await reopened.listLlmModels({ userId: 'test-user-1' });
    expect(models).toHaveLength(1);
    await reopened.close();
  });
});
