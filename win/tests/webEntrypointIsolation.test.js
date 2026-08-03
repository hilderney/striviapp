'use strict';

const path = require('path');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');

describe('win web entrypoint isolation', () => {
  const envBackup = {};

  beforeEach(() => {
    for (const key of ['PERSISTENCE', 'DB_PATH', 'OUTPUT_DIR', 'LOGS_DIR']) {
      envBackup[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('importar win/src/server.js não sobe o servidor', () => {
    jest.isolateModules(() => {
      const server = require('../src/server');
      expect(typeof server.resolvePersistenceConfig).toBe('function');
      expect(typeof server.createWebApp).toBe('function');
      expect(typeof server.main).toBe('function');
    });
  });

  it('resolvePersistenceConfig retorna sqlite por padrão', () => {
    delete process.env.PERSISTENCE;
    const { resolvePersistenceConfig } = require('../src/server');
    const config = resolvePersistenceConfig();
    expect(config.type).toBe('sqlite');
    expect(path.isAbsolute(config.options.dbPath)).toBe(true);
    expect(config.options.dbPath).toContain(path.join('data', 'app.db'));
  });

  it('resolvePersistenceConfig falha com PERSISTENCE=mysql', () => {
    process.env.PERSISTENCE = 'mysql';
    const { resolvePersistenceConfig } = require('../src/server');
    expect(() => resolvePersistenceConfig()).toThrow(/PERSISTENCE=mysql não é suportado em win\//);
  });

  it("createPersistenceAdapter('mysql') lança Unknown persistence adapter", () => {
    expect(() => createPersistenceAdapter('mysql')).toThrow('Unknown persistence adapter: mysql');
  });
});
