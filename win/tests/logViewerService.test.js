const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { LogViewerError } = require('../src/errors');
const {
  listLogs,
  readLog,
  deleteLog,
  batchDeleteLogs,
} = require('../src/modules/logViewerService');
const { createAppServer } = require('../src/modules/appServer');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const phase1Api = require('../src/api');

const TEST_KEY = Buffer.alloc(32, 11).toString('hex');

function createTempLogsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'log-viewer-'));
}

function writeLog(dir, name, content = '{"level":"info"}\n') {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

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

describe('logViewerService — listLogs', () => {
  let logsDir;

  beforeEach(() => {
    logsDir = createTempLogsDir();
  });

  afterEach(async () => {
    await fsp.rm(logsDir, { recursive: true, force: true });
  });

  test('[F4-01] deve retornar [] se logsDir não existe', async () => {
    const missing = path.join(logsDir, 'does-not-exist');
    await expect(listLogs(missing)).resolves.toEqual([]);
  });

  test('[F4-02] deve listar apenas arquivos .log (ignorar .txt, subpastas)', async () => {
    writeLog(logsDir, 'session_a.log');
    writeLog(logsDir, 'notes.txt', 'ignore');
    fs.mkdirSync(path.join(logsDir, 'subdir'));
    writeLog(path.join(logsDir, 'subdir'), 'nested.log');

    const logs = await listLogs(logsDir);
    expect(logs.map((entry) => entry.name)).toEqual(['session_a.log']);
  });

  test('[F4-03] cada entry deve conter name, path, sizeBytes, modifiedAt', async () => {
    writeLog(logsDir, 'session_a.log', 'hello');
    const [entry] = await listLogs(logsDir);
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'session_a.log',
        path: path.join(logsDir, 'session_a.log'),
        sizeBytes: expect.any(Number),
        modifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  test('[F4-04] deve ordenar por name asc/desc', async () => {
    writeLog(logsDir, 'b.log');
    writeLog(logsDir, 'a.log');
    writeLog(logsDir, 'c.log');

    const asc = await listLogs(logsDir, { sort: 'name', order: 'asc' });
    expect(asc.map((entry) => entry.name)).toEqual(['a.log', 'b.log', 'c.log']);

    const desc = await listLogs(logsDir, { sort: 'name', order: 'desc' });
    expect(desc.map((entry) => entry.name)).toEqual(['c.log', 'b.log', 'a.log']);
  });

  test('[F4-05] deve ordenar por date asc/desc', async () => {
    writeLog(logsDir, 'old.log');
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeLog(logsDir, 'new.log');

    const desc = await listLogs(logsDir, { sort: 'date', order: 'desc' });
    expect(desc[0].name).toBe('new.log');

    const asc = await listLogs(logsDir, { sort: 'date', order: 'asc' });
    expect(asc[0].name).toBe('old.log');
  });

  test('[F4-06] deve filtrar por search (case-insensitive, qualquer posição)', async () => {
    writeLog(logsDir, 'session_ABC_1.log');
    writeLog(logsDir, 'session_xyz.log');
    writeLog(logsDir, 'other.log');

    const filtered = await listLogs(logsDir, { search: 'abc' });
    expect(filtered.map((entry) => entry.name)).toEqual(['session_ABC_1.log']);
  });
});

describe('logViewerService — readLog', () => {
  let logsDir;

  beforeEach(() => {
    logsDir = createTempLogsDir();
  });

  afterEach(async () => {
    await fsp.rm(logsDir, { recursive: true, force: true });
  });

  test('[F4-07] deve retornar { name, content } com conteúdo textual', async () => {
    writeLog(logsDir, 'session.log', '{"level":"info"}\n');
    await expect(readLog(logsDir, 'session.log')).resolves.toEqual({
      name: 'session.log',
      content: '{"level":"info"}\n',
    });
  });

  test('[F4-08] deve lançar LogViewerError 400 se filename tem ..', async () => {
    await expect(readLog(logsDir, '../session.log')).rejects.toMatchObject({
      name: 'LogViewerError',
      statusCode: 400,
      code: 'INVALID_PATH',
    });
  });

  test('[F4-09] deve lançar LogViewerError 400 se filename contém /', async () => {
    await expect(readLog(logsDir, 'sub/session.log')).rejects.toMatchObject({
      name: 'LogViewerError',
      statusCode: 400,
      code: 'INVALID_PATH',
    });
  });

  test('[F4-10] deve lançar LogViewerError 400 se extensão não é .log', async () => {
    await expect(readLog(logsDir, 'session.txt')).rejects.toMatchObject({
      name: 'LogViewerError',
      statusCode: 400,
      code: 'INVALID_EXTENSION',
    });
  });

  test('[F4-11] deve lançar LogViewerError 404 se arquivo não existe', async () => {
    await expect(readLog(logsDir, 'missing.log')).rejects.toMatchObject({
      name: 'LogViewerError',
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('logViewerService — deleteLog', () => {
  let logsDir;

  beforeEach(() => {
    logsDir = createTempLogsDir();
  });

  afterEach(async () => {
    await fsp.rm(logsDir, { recursive: true, force: true });
  });

  test('[F4-12] deve deletar arquivo e retornar { deleted: true }', async () => {
    writeLog(logsDir, 'session.log');
    await expect(deleteLog(logsDir, 'session.log')).resolves.toEqual({
      deleted: true,
      name: 'session.log',
    });
    expect(fs.existsSync(path.join(logsDir, 'session.log'))).toBe(false);
  });

  test('[F4-13] deve lançar LogViewerError 400 se path traversal', async () => {
    await expect(deleteLog(logsDir, '..\\session.log')).rejects.toBeInstanceOf(LogViewerError);
    await expect(deleteLog(logsDir, '..\\session.log')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('[F4-14] deve lançar LogViewerError 400 se extensão não é .log', async () => {
    await expect(deleteLog(logsDir, 'session.txt')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_EXTENSION',
    });
  });
});

describe('logViewerService — batchDeleteLogs', () => {
  let logsDir;

  beforeEach(() => {
    logsDir = createTempLogsDir();
  });

  afterEach(async () => {
    await fsp.rm(logsDir, { recursive: true, force: true });
  });

  test('[F4-15] deve deletar múltiplos e retornar deleted: N', async () => {
    writeLog(logsDir, 'a.log');
    writeLog(logsDir, 'b.log');
    const result = await batchDeleteLogs(logsDir, ['a.log', 'b.log']);
    expect(result.deleted).toBe(2);
    expect(result.files).toEqual(['a.log', 'b.log']);
    expect(fs.existsSync(path.join(logsDir, 'a.log'))).toBe(false);
  });

  test('[F4-16] deve ignorar nomes inexistentes (failed: [])', async () => {
    writeLog(logsDir, 'a.log');
    const result = await batchDeleteLogs(logsDir, ['a.log', 'missing.log']);
    expect(result.deleted).toBe(1);
    expect(result.failed).toEqual([]);
  });

  test('[F4-17] deve lançar LogViewerError 400 se array vazio', async () => {
    await expect(batchDeleteLogs(logsDir, [])).rejects.toMatchObject({ statusCode: 400 });
  });

  test('[F4-18] deve lançar LogViewerError 400 se algum nome é path traversal (nada deletado)', async () => {
    writeLog(logsDir, 'a.log');
    await expect(batchDeleteLogs(logsDir, ['a.log', '../evil.log'])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fs.existsSync(path.join(logsDir, 'a.log'))).toBe(true);
  });
});

describe('logViewerService — API REST (integração com appServer)', () => {
  let server;
  let logsDir;
  let outputDir;
  let staticDir;

  beforeEach(async () => {
    logsDir = createTempLogsDir();
    outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'log-viewer-out-'));
    staticDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'log-viewer-static-'));
    await fsp.writeFile(path.join(staticDir, 'index.html'), '<html></html>');

    const persistence = createPersistenceAdapter('memory');
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
      createLlmAdapterFn: () => ({ complete: async () => ({ content: '{}' }) }),
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
    await fsp.rm(logsDir, { recursive: true, force: true });
    await fsp.rm(outputDir, { recursive: true, force: true });
    await fsp.rm(staticDir, { recursive: true, force: true });
  });

  test('[F4-19] GET /api/v1/logs deve retornar 200 com array logs', async () => {
    writeLog(logsDir, 'session.log');
    const res = await request(`${server.url}/api/v1/logs`);
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(Array.isArray(payload.logs)).toBe(true);
    expect(payload.logs[0].name).toBe('session.log');
  });

  test('[F4-20] GET /api/v1/logs/:name deve retornar 200 com content', async () => {
    writeLog(logsDir, 'session.log', 'line1\n');
    const res = await request(`${server.url}/api/v1/logs/${encodeURIComponent('session.log')}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ name: 'session.log', content: 'line1\n' });
  });

  test('[F4-21] GET /api/v1/logs/../foo.log deve retornar 400', async () => {
    const res = await request(`${server.url}/api/v1/logs/${encodeURIComponent('../foo.log')}`);
    expect(res.statusCode).toBe(400);
  });

  test('[F4-22] GET /api/v1/logs/inexistente.log deve retornar 404', async () => {
    const res = await request(`${server.url}/api/v1/logs/inexistente.log`);
    expect(res.statusCode).toBe(404);
  });

  test('[F4-23] DELETE /api/v1/logs/:name deve retornar 200', async () => {
    writeLog(logsDir, 'session.log');
    const res = await request(`${server.url}/api/v1/logs/session.log`, { method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true, name: 'session.log' });
  });

  test('[F4-24] POST /api/v1/logs/batch-delete com body válido → 200', async () => {
    writeLog(logsDir, 'a.log');
    writeLog(logsDir, 'b.log');
    const res = await request(
      `${server.url}/api/v1/logs/batch-delete`,
      { method: 'POST' },
      { files: ['a.log', 'b.log'] },
    );
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.deleted).toBe(2);
    expect(payload.files).toEqual(['a.log', 'b.log']);
  });

  test('[F4-25] POST /api/v1/logs/batch-delete com array vazio → 400', async () => {
    const res = await request(
      `${server.url}/api/v1/logs/batch-delete`,
      { method: 'POST' },
      { files: [] },
    );
    expect(res.statusCode).toBe(400);
  });
});
