'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveDesktopPaths } = require('../desktop/desktopConfig');
const { createDesktopApp } = require('../src/desktop/createDesktopApp');

describe('createDesktopApp (F7-59..F7-62)', () => {
  let tmpDir;
  let paths;
  const phase1Api = { scan: () => [] };
  const envBackup = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-app-'));
    paths = resolveDesktopPaths({
      userData: path.join(tmpDir, 'userData'),
      documents: path.join(tmpDir, 'Documents'),
    });
    for (const key of ['APP_SECRET_KEY', 'JWT_SECRET', 'APP_MODE', 'PERSISTENCE', 'DISABLE_TOTP']) {
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('usa porta efêmera para não colidir com o produto web', () => {
    const app = createDesktopApp({ paths, phase1Api, appSecretKey: 'a', jwtSecret: 'b' });

    expect(app.config.port).toBe(0);
    expect(app.config.host).toBe('127.0.0.1');
  });

  it('aponta persistência, logs, staging, input e output para paths absolutos do desktop', () => {
    const app = createDesktopApp({ paths, phase1Api, appSecretKey: 'a', jwtSecret: 'b' });

    expect(app.config.persistenceType).toBe('sqlite');
    expect(app.config.dbPath).toBe(paths.dbPath);
    expect(app.config.logsDir).toBe(paths.logsDir);
    expect(app.config.stagingDir).toBe(paths.stagingDir);
    expect(app.config.inputDir).toBe(paths.inputDir);
    expect(app.config.outputDir).toBe(paths.outputDir);
    for (const dir of Object.values(app.config)) {
      if (typeof dir === 'string' && dir.startsWith(tmpDir)) {
        expect(path.isAbsolute(dir)).toBe(true);
      }
    }
  });

  it('cria os diretórios graváveis antes do start', () => {
    createDesktopApp({ paths, phase1Api, appSecretKey: 'a', jwtSecret: 'b' });

    for (const dir of [paths.appData, paths.logsDir, paths.stagingDir, paths.inputDir, paths.outputDir]) {
      expect(fs.existsSync(dir)).toBe(true);
    }
  });

  it('injeta os segredos e força modo desktop single-tenant', () => {
    process.env.PERSISTENCE = 'mysql';

    createDesktopApp({ paths, phase1Api, appSecretKey: 'secret-key', jwtSecret: 'jwt-key' });

    expect(process.env.APP_SECRET_KEY).toBe('secret-key');
    expect(process.env.JWT_SECRET).toBe('jwt-key');
    expect(process.env.APP_MODE).toBe('desktop');
    expect(process.env.PERSISTENCE).toBe('sqlite');
    expect(process.env.DISABLE_TOTP).toBe('1');
  });

  it('serve a SPA empacotada em win/public', () => {
    const app = createDesktopApp({ paths, phase1Api, appSecretKey: 'a', jwtSecret: 'b' });

    expect(app.config.staticDir).toBe(path.join(__dirname, '..', 'public'));
    expect(fs.existsSync(path.join(app.config.staticDir, 'index.html'))).toBe(true);
  });

  it('exige paths e phase1Api', () => {
    expect(() => createDesktopApp({ phase1Api })).toThrow('paths is required');
    expect(() => createDesktopApp({ paths })).toThrow('phase1Api is required');
  });
});
