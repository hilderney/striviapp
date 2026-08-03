'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { resolveDesktopPaths } = require('../desktop/desktopConfig');
const { createDesktopApp } = require('../src/desktop/createDesktopApp');
const phase1Api = require('../src/api');

describe('desktop bootstrap integração (F7-54)', () => {
  let tmpDir;
  let paths;
  let app;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-boot-'));
    paths = resolveDesktopPaths({
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
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sobe o servidor local em porta efêmera de loopback', () => {
    expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(new URL(app.url).port).not.toBe('0');
  });

  it('cria o banco SQLite no diretório de dados do usuário', () => {
    expect(fs.existsSync(paths.dbPath)).toBe(true);
  });

  it('serve a SPA na raiz', async () => {
    const response = await fetch(`${app.url}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html');
  });

  it('exige autenticação nas rotas protegidas da API', async () => {
    const response = await fetch(`${app.url}/api/v1/files`);

    expect(response.status).toBe(401);
  });

  it('fecha e reabre reutilizando o mesmo banco local', async () => {
    await app.close();

    app = createDesktopApp({
      paths,
      phase1Api,
      appSecretKey: crypto.randomBytes(32).toString('hex'),
      jwtSecret: crypto.randomBytes(32).toString('hex'),
    });
    await app.start();

    const response = await fetch(`${app.url}/`);
    expect(response.status).toBe(200);
  }, 60000);
});
