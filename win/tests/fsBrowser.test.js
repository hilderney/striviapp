const fs = require('fs/promises');
const path = require('path');
const { getRoots, browse } = require('../src/modules/fsBrowser');
const { createTempDir, writeMinimalPdf } = require('./helpers/fixtures');

describe('fsBrowser', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('fs-browser-');
    await writeMinimalPdf(tempDir, 'doc.pdf');
    await fs.mkdir(path.join(tempDir, 'sub'), { recursive: true });
    await writeMinimalPdf(path.join(tempDir, 'sub'), 'nested.pdf');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('getRoots retorna defaultPath e roots', async () => {
    const result = await getRoots();
    expect(result.defaultPath).toBeTruthy();
    expect(result.roots.length).toBeGreaterThan(0);
  });

  test('browse lista pastas e PDFs no diretório atual', async () => {
    const result = await browse(tempDir);
    expect(result.currentPath).toBe(path.resolve(tempDir));
    expect(result.directories.some((dir) => dir.name === 'sub')).toBe(true);
    expect(result.pdfs.some((pdf) => pdf.name === 'doc.pdf')).toBe(true);
    expect(result.pdfCount).toBe(1);
  });

  test('browse falha para caminho inexistente', async () => {
    await expect(browse(path.join(tempDir, 'missing'))).rejects.toThrow('Path not found');
  });
});
