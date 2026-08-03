const { InMemoryPersistenceAdapter } = require('../src/adapters/memoryPersistenceAdapter');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');

describe('memoryPersistence', () => {
  let persistence;

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter();
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  test('[F2-11] deve implementar mesma interface que sqlite (contrato)', async () => {
    expect(typeof persistence.createLlmModel).toBe('function');
    expect(typeof persistence.getLlmModel).toBe('function');
    expect(typeof persistence.listLlmModels).toBe('function');
    expect(typeof persistence.updateLlmModel).toBe('function');
    expect(typeof persistence.deleteLlmModel).toBe('function');
    expect(typeof persistence.createLlmJob).toBe('function');
    expect(typeof persistence.getLlmJob).toBe('function');
    expect(typeof persistence.listLlmJobs).toBe('function');
    expect(typeof persistence.updateLlmJob).toBe('function');
  });

  test('[F2-12] dados não persistem após nova instância (isolamento de teste)', async () => {
    const created = await persistence.createLlmModel({
      userId: 'test-user-1',
      name: 'Test',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: false,
    });

    await persistence.close();

    const fresh = createPersistenceAdapter('memory');
    await fresh.init();
    const found = await fresh.getLlmModel(created.id);
    expect(found).toBeNull();
    await fresh.close();
  });
});
