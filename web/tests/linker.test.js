const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createServer } = require('../src/modules/linker');
const { createTempDir, writeTextFile } = require('./helpers/fixtures');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('linker', () => {
  let outputDir;
  let server;

  beforeEach(async () => {
    outputDir = await createTempDir('linker-test-');
    await writeTextFile(outputDir, 'sample.txt', 'hello txt');
    await writeTextFile(outputDir, 'sample.csv', 'a,b');
    await writeTextFile(outputDir, 'sample.xlsx', 'PK fake');
    await writeTextFile(outputDir, 'sample.pdf', '%PDF fake');
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-30] deve iniciar um servidor HTTP na porta configurável (default: 4000)', async () => {
    server = await createServer({ port: 0, outputDir });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);
  });

  test('[RED-31] GET /files deve retornar JSON listando todos os arquivos em output/', async () => {
    server = await createServer({ port: 0, outputDir });
    const response = await request(`${server.url}/files`);

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sample.txt', url: expect.stringContaining('/open/sample.txt') }),
        expect.objectContaining({ name: 'sample.csv' }),
      ]),
    );
  });

  test('[RED-32] GET /open/:filename deve servir o arquivo para download/visualização', async () => {
    server = await createServer({ port: 0, outputDir });
    const response = await request(`${server.url}/open/sample.txt`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('hello txt');
  });

  test('[RED-33] deve retornar 404 com mensagem JSON se o arquivo não existir', async () => {
    server = await createServer({ port: 0, outputDir });
    const response = await request(`${server.url}/open/missing.txt`);

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'File not found' });
  });

  test('[RED-34] deve retornar Content-Type correto: application/pdf, text/plain, text/csv, application/vnd...xlsx', async () => {
    server = await createServer({ port: 0, outputDir });

    const pdf = await request(`${server.url}/open/sample.pdf`);
    const txt = await request(`${server.url}/open/sample.txt`);
    const csv = await request(`${server.url}/open/sample.csv`);
    const xlsx = await request(`${server.url}/open/sample.xlsx`);

    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(txt.headers['content-type']).toContain('text/plain');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(xlsx.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  test('[RED-35] deve rejeitar path traversal (e.g. ../../etc/passwd → 400)', async () => {
    server = await createServer({ port: 0, outputDir });
    const response = await request(`${server.url}/open/${encodeURIComponent('../../etc/passwd')}`);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Invalid file path' });
  });

  test('[RED-36] deve encerrar o servidor graciosamente ao chamar server.close()', async () => {
    server = await createServer({ port: 0, outputDir });
    await expect(server.close()).resolves.toBeUndefined();
    server = null;
  });
});
