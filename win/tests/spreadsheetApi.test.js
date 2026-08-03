const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createAppServer } = require('../src/modules/appServer');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const phase1Api = require('../src/api');
const { createTempDir } = require('./helpers/fixtures');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');
const TEST_KEY = Buffer.alloc(32, 11).toString('hex');

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
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
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

describe('spreadsheetApi', () => {
  let server;
  let outputDir;
  let staticDir;
  let inputDir;
  let logsDir;
  let persistence;
  let llmModelService;
  let llmProcessService;

  beforeEach(async () => {
    outputDir = await createTempDir('spreadsheet-api-output-');
    staticDir = await createTempDir('spreadsheet-api-static-');
    inputDir = await createTempDir('spreadsheet-api-input-');
    logsDir = await createTempDir('spreadsheet-api-logs-');

    await fs.mkdir(path.join(staticDir, 'css'), { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>App</body></html>');
    await fs.copyFile(FIXTURE_PATH, path.join(inputDir, 'unimed-demonstrativo.xls'));

    persistence = createPersistenceAdapter('memory');
    await persistence.init();

    llmModelService = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });

    llmProcessService = createLlmProcessService({
      persistence,
      modelService: llmModelService,
      outputDir,
      baseUrl: 'http://127.0.0.1:0',
    });

    server = await createAppServer({
      port: 0,
      outputDir,
      staticDir,
      logsDir,
      inputDir,
      phase1Api,
      llmModelService,
      llmProcessService,
    });

    llmProcessService = createLlmProcessService({
      persistence,
      modelService: llmModelService,
      outputDir,
      baseUrl: server.url,
    });

    await server.close();
    server = await createAppServer({
      port: 0,
      outputDir,
      staticDir,
      logsDir,
      inputDir,
      phase1Api,
      llmModelService,
      llmProcessService,
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    await persistence.close();
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(staticDir, { recursive: true, force: true });
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('[F3-55] POST /api/v1/spreadsheet/scan deve listar .xls/.xlsx/.csv no inputDir', async () => {
    const response = await request(`${server.url}/api/v1/spreadsheet/scan`, { method: 'POST' }, {
      inputDir,
    });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.files.some((file) => file.name === 'unimed-demonstrativo.xls')).toBe(true);
  });

  test('[F3-56] POST /api/v1/spreadsheet/import deve retornar 201 com exports e metadata', async () => {
    const response = await request(`${server.url}/api/v1/spreadsheet/import`, { method: 'POST' }, {
      sourceFile: 'unimed-demonstrativo.xls',
      inputDir,
      outputDir,
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body);
    expect(payload.rowCount).toBeGreaterThan(0);
    expect(payload.metadata.prestador).toContain('CLINICA ARARA AZUL');
    expect(payload.exports.csv.url).toContain('/open/');
    expect(payload.exports.xlsx.url).toContain('/open/');
  });

  test('[F3-57] POST /api/v1/spreadsheet/import com arquivo inexistente → 404', async () => {
    const response = await request(`${server.url}/api/v1/spreadsheet/import`, { method: 'POST' }, {
      sourceFile: 'missing.xls',
      inputDir,
      outputDir,
    });
    expect(response.statusCode).toBe(404);
  });

  test('[F3-58] POST /api/v1/spreadsheet/import com body inválido → 400', async () => {
    const response = await request(`${server.url}/api/v1/spreadsheet/import`, { method: 'POST' }, {
      inputDir,
    });
    expect(response.statusCode).toBe(400);
  });

  test('[F3-59] arquivos gerados devem ser acessíveis via GET /open/:filename', async () => {
    const importRes = await request(`${server.url}/api/v1/spreadsheet/import`, { method: 'POST' }, {
      sourceFile: 'unimed-demonstrativo.xls',
      inputDir,
      outputDir,
    });
    const payload = JSON.parse(importRes.body);
    const fileName = path.basename(payload.exports.csv.filePath);
    const openRes = await request(`${server.url}/open/${encodeURIComponent(fileName)}`);
    expect(openRes.statusCode).toBe(200);
    expect(openRes.body).toContain('Requisição');
  });

  test('[F3-60] path traversal em sourceFile continua bloqueado (regressão Fase 1/2)', async () => {
    const response = await request(`${server.url}/api/v1/spreadsheet/import`, { method: 'POST' }, {
      sourceFile: '../../etc/passwd',
      inputDir,
      outputDir,
    });
    expect(response.statusCode).toBe(400);
  });
});
