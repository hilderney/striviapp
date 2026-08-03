const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createAppServer } = require('../src/modules/appServer');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const phase1Api = require('../src/api');
const { createValidPdfBuffer, createTempDir } = require('./helpers/fixtures');

const FIXTURE_TSV = path.join(__dirname, '..', 'fixtures', 'unimed-demonstrativo.tsv');
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

describe('inputApi', () => {
  let server;
  let outputDir;
  let staticDir;
  let logsDir;
  let persistence;

  beforeEach(async () => {
    outputDir = await createTempDir('input-api-output-');
    staticDir = await createTempDir('input-api-static-');
    logsDir = await createTempDir('input-api-logs-');
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>App</body></html>');

    persistence = createPersistenceAdapter('memory');
    await persistence.init();

    const llmModelService = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });

    const llmProcessService = createLlmProcessService({
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
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('POST /api/v1/input/run processa PDF e XLS selecionados', async () => {
    const pdfBuffer = await createValidPdfBuffer('api input');
    const xlsContent = await fs.readFile(FIXTURE_TSV);

    const response = await request(`${server.url}/api/v1/input/run`, { method: 'POST' }, {
      files: [
        { name: 'doc.pdf', data: pdfBuffer.toString('base64') },
        { name: 'demo.xls', data: xlsContent.toString('base64') },
      ],
      processNames: ['doc.pdf', 'demo.xls'],
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body);
    expect(payload.processed).toBe(2);
    expect(payload.staged.fileCount).toBe(2);
  });

  test('POST /api/v1/input/stage aceita PDF e XLSX', async () => {
    const pdfBuffer = await createValidPdfBuffer('stage');
    const response = await request(`${server.url}/api/v1/input/stage`, { method: 'POST' }, {
      files: [{ name: 'a.pdf', data: pdfBuffer.toString('base64') }],
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).pdfCount).toBe(1);
  });
});
