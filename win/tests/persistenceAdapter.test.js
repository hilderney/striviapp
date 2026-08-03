const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { InMemoryPersistenceAdapter } = require('../src/adapters/memoryPersistenceAdapter');
const { SqlitePersistenceAdapter } = require('../src/adapters/sqlitePersistenceAdapter');

describe('persistenceAdapter factory', () => {
  test('createPersistenceAdapter retorna implementações conhecidas', () => {
    expect(createPersistenceAdapter('memory')).toBeInstanceOf(InMemoryPersistenceAdapter);
    expect(createPersistenceAdapter('sqlite')).toBeInstanceOf(SqlitePersistenceAdapter);
  });

  test('createPersistenceAdapter lança para tipo desconhecido', () => {
    expect(() => createPersistenceAdapter('postgres')).toThrow('Unknown persistence adapter');
  });
});
