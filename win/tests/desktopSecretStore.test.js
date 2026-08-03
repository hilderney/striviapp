'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createDesktopSecretStore,
  SecureStorageUnavailableError,
  STORE_VERSION,
} = require('../desktop/desktopSecretStore');

function createFakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`dpapi:${plain}`, 'utf8'),
    decryptString: (buffer) => {
      const raw = buffer.toString('utf8');
      if (!raw.startsWith('dpapi:')) {
        throw new Error('bad payload');
      }
      return raw.slice('dpapi:'.length);
    },
  };
}

describe('desktopSecretStore (F7-63..F7-64)', () => {
  let tmpDir;
  let filePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-store-'));
    filePath = path.join(tmpDir, 'app-data', 'secrets.bin');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cria segredos na primeira execução e persiste em arquivo', () => {
    const store = createDesktopSecretStore({ filePath, safeStorage: createFakeSafeStorage() });

    const secrets = store.loadOrCreate();

    expect(secrets.version).toBe(STORE_VERSION);
    expect(secrets.appSecretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.jwtSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.appSecretKey).not.toBe(secrets.jwtSecret);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('reutiliza os mesmos segredos em execuções seguintes', () => {
    const safeStorage = createFakeSafeStorage();
    const first = createDesktopSecretStore({ filePath, safeStorage }).loadOrCreate();
    const second = createDesktopSecretStore({ filePath, safeStorage }).loadOrCreate();

    expect(second.appSecretKey).toBe(first.appSecretKey);
    expect(second.jwtSecret).toBe(first.jwtSecret);
  });

  it('grava conteúdo cifrado, nunca em texto claro', () => {
    const store = createDesktopSecretStore({ filePath, safeStorage: createFakeSafeStorage() });
    const secrets = store.loadOrCreate();

    const onDisk = fs.readFileSync(filePath, 'utf8');
    expect(onDisk.startsWith('dpapi:')).toBe(true);
    expect(onDisk).toContain(secrets.appSecretKey);
    expect(() => JSON.parse(onDisk)).toThrow();
  });

  it('persiste alterações via save preservando a versão', () => {
    const safeStorage = createFakeSafeStorage();
    const store = createDesktopSecretStore({ filePath, safeStorage });
    const secrets = store.loadOrCreate();

    store.save({ ...secrets, activationToken: 'token-123' });

    const reloaded = createDesktopSecretStore({ filePath, safeStorage }).loadOrCreate();
    expect(reloaded.activationToken).toBe('token-123');
    expect(reloaded.version).toBe(STORE_VERSION);
  });

  it('falha fechada quando o DPAPI não está disponível', () => {
    const store = createDesktopSecretStore({
      filePath,
      safeStorage: createFakeSafeStorage({ available: false }),
    });

    expect(() => store.loadOrCreate()).toThrow(SecureStorageUnavailableError);
    expect(() => store.loadOrCreate()).toThrow('SECURE_STORAGE_UNAVAILABLE');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('rejeita store com versão desconhecida', () => {
    const safeStorage = createFakeSafeStorage();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify({ version: 99 })));

    const store = createDesktopSecretStore({ filePath, safeStorage });
    expect(() => store.loadOrCreate()).toThrow('Unsupported secret store version');
  });

  it('exige filePath e safeStorage', () => {
    expect(() => createDesktopSecretStore({ safeStorage: createFakeSafeStorage() })).toThrow(
      'filePath is required',
    );
    expect(() => createDesktopSecretStore({ filePath })).toThrow('safeStorage is required');
  });
});
