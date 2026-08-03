const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createAppServer } = require('../src/modules/appServer');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const phase1Api = require('../src/api');
const { createTempDir, writeMinimalPdf, writeTextFile } = require('./helpers/fixtures');

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

describe('appServer', () => {
  let server;
  let outputDir;
  let staticDir;
  let inputDir;
  let logsDir;
  let persistence;
  let llmModelService;
  let llmProcessService;
  let mockAdapter;

  beforeEach(async () => {
    outputDir = await createTempDir('app-server-output-');
    staticDir = await createTempDir('app-server-static-');
    inputDir = await createTempDir('app-server-input-');
    logsDir = await createTempDir('app-server-logs-');

    await fs.mkdir(path.join(staticDir, 'css'), { recursive: true });
    await fs.mkdir(path.join(staticDir, 'js'), { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>App</body></html>');
    await fs.writeFile(path.join(staticDir, 'css', 'app.css'), 'body {}');
    const { OPEN_MODE_USER_ID } = require('../src/utils/userWorkspace');
    const userOutputDir = path.join(outputDir, OPEN_MODE_USER_ID);
    await fs.mkdir(userOutputDir, { recursive: true });
    await writeTextFile(userOutputDir, 'sample.json', '{"ok":true}');
    await writeTextFile(userOutputDir, 'doc.txt', 'hello');
    await writeMinimalPdf(inputDir, 'doc.pdf');

    persistence = createPersistenceAdapter('memory');
    await persistence.init();

    llmModelService = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });

    mockAdapter = {
      complete: jest.fn(async () => ({
        content: JSON.stringify({ summary: 'API summary' }),
        raw: {},
        usage: { promptTokens: 1, completionTokens: 1 },
      })),
    };

    llmProcessService = createLlmProcessService({
      persistence,
      modelService: llmModelService,
      outputDir,
      baseUrl: 'http://127.0.0.1:0',
      createLlmAdapterFn: () => mockAdapter,
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

    llmProcessService = createLlmProcessService({
      persistence,
      modelService: llmModelService,
      outputDir,
      baseUrl: server.url,
      createLlmAdapterFn: () => mockAdapter,
    });

    await server.close();
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
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  test('[F2-44] GET / deve servir index.html', async () => {
    const response = await request(`${server.url}/`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('App');
  });

  test('[F2-45] GET /api/v1/files deve incluir arquivos .json', async () => {
    const response = await request(`${server.url}/api/v1/files`);
    const payload = JSON.parse(response.body);
    expect(payload.files.some((file) => file.name === 'sample.json')).toBe(true);
  });

  test('GET /api/v1/files usa a porta efetiva do listen, não port: 0', async () => {
    const response = await request(`${server.url}/api/v1/files`);
    const payload = JSON.parse(response.body);
    const sample = payload.files.find((file) => file.name === 'sample.json');

    expect(sample.url.startsWith(server.url)).toBe(true);
    expect(new URL(sample.url).port).toBe(String(server.port));

    const download = await request(sample.url);
    expect(download.statusCode).toBe(200);
  });

  test('[F2-46] CRUD /api/v1/llm/models end-to-end com persistence memory', async () => {
    const created = await request(`${server.url}/api/v1/llm/models`, { method: 'POST' }, {
      name: 'Ollama Local',
      provider: 'ollama',
      modelId: 'llama3',
      isDefault: true,
    });
    expect(created.statusCode).toBe(201);
    const model = JSON.parse(created.body);

    const listed = await request(`${server.url}/api/v1/llm/models`);
    expect(JSON.parse(listed.body).models).toHaveLength(1);

    const updated = await request(`${server.url}/api/v1/llm/models/${model.id}`, { method: 'PUT' }, {
      name: 'Updated',
    });
    expect(JSON.parse(updated.body).name).toBe('Updated');

    const deleted = await request(`${server.url}/api/v1/llm/models/${model.id}`, {
      method: 'DELETE',
    });
    expect(deleted.statusCode).toBe(204);
  });

  test('[F2-47] POST /api/v1/llm/process deve retornar 201 com summary e responseUrl', async () => {
    const modelRes = await request(`${server.url}/api/v1/llm/models`, { method: 'POST' }, {
      name: 'Ollama',
      provider: 'ollama',
      modelId: 'llama3',
    });
    const model = JSON.parse(modelRes.body);

    const response = await request(`${server.url}/api/v1/llm/process`, { method: 'POST' }, {
      llmModelId: model.id,
      sourceFile: 'doc.txt',
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body);
    expect(payload.summary).toBe('API summary');
    expect(payload.responseUrl).toContain('/open/');
  });

  test('[F2-48] POST /api/v1/pipeline/run deve delegar ao PdfSummarizerBuilder', async () => {
    const response = await request(`${server.url}/api/v1/pipeline/run`, { method: 'POST' }, {
      inputDir,
      outputDir,
      logsDir,
      overwrite: true,
      formats: ['csv'],
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.scanned).toBe(1);
    expect(payload.extracted).toBe(1);
  }, 30000);

  test('[F2-49] deve retornar 400 para JSON body inválido', async () => {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        `${server.url}/api/v1/llm/models`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
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
      req.write('{ invalid');
      req.end();
    });

    expect(response.statusCode).toBe(400);
  });

  test('[F2-50] path traversal em /open/:filename continua bloqueado (regressão Fase 1)', async () => {
    const response = await request(`${server.url}/open/${encodeURIComponent('../../etc/passwd')}`);
    expect(response.statusCode).toBe(400);
  });

  test('GET /css/app.css serve asset estático', async () => {
    const response = await request(`${server.url}/css/app.css`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('body');
  });

  test('GET /api/v1/fs/roots e browse funcionam', async () => {
    const rootsRes = await request(`${server.url}/api/v1/fs/roots`);
    expect(rootsRes.statusCode).toBe(200);

    const browseRes = await request(
      `${server.url}/api/v1/fs/browse?path=${encodeURIComponent(inputDir)}`,
    );
    expect(browseRes.statusCode).toBe(200);
    expect(JSON.parse(browseRes.body).pdfs).toHaveLength(1);
  });

  test('POST /api/v1/pipeline/scan lista PDFs', async () => {
    const response = await request(`${server.url}/api/v1/pipeline/scan`, { method: 'POST' }, {
      inputDir,
      recursive: false,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).pdfs).toHaveLength(1);
  });

  test('GET /api/v1/llm/jobs/:id retorna job', async () => {
    const modelRes = await request(`${server.url}/api/v1/llm/models`, { method: 'POST' }, {
      name: 'Ollama',
      provider: 'ollama',
      modelId: 'llama3',
    });
    const model = JSON.parse(modelRes.body);

    const processRes = await request(`${server.url}/api/v1/llm/process`, { method: 'POST' }, {
      llmModelId: model.id,
      sourceFile: 'doc.txt',
    });
    const { jobId } = JSON.parse(processRes.body);

    const jobRes = await request(`${server.url}/api/v1/llm/jobs/${jobId}`);
    expect(jobRes.statusCode).toBe(200);
    expect(JSON.parse(jobRes.body).id).toBe(jobId);
  });
});
