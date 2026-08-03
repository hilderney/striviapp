const fs = require('fs/promises');
const path = require('path');
const { listPdfs } = require('../src/modules/scanner');
const { ScannerError } = require('../src/errors');
const { createTempDir, writeMinimalPdf, writeTextFile } = require('./helpers/fixtures');

describe('scanner', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('scanner-test-');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[RED-01] deve retornar array vazio quando o diretório não existe', async () => {
    const result = await listPdfs(path.join(tempDir, 'missing'));
    expect(result).toEqual([]);
  });

  test('[RED-02] deve retornar array vazio quando o diretório não contém PDFs', async () => {
    await writeTextFile(tempDir, 'notes.txt', 'hello');
    const result = await listPdfs(tempDir);
    expect(result).toEqual([]);
  });

  test('[RED-03] deve listar apenas arquivos com extensão .pdf (case-insensitive)', async () => {
    await writeMinimalPdf(tempDir, 'doc.pdf');
    await writeMinimalPdf(tempDir, 'report.Pdf');
    await writeTextFile(tempDir, 'readme.txt', 'x');

    const result = await listPdfs(tempDir);
    expect(result).toHaveLength(2);
    expect(result.every((item) => /\.pdf$/i.test(item.name))).toBe(true);
  });

  test('[RED-04] deve incluir caminho absoluto de cada arquivo listado', async () => {
    const pdfPath = await writeMinimalPdf(tempDir, 'doc.pdf');
    const [item] = await listPdfs(tempDir);

    expect(item.path).toBe(path.resolve(pdfPath));
    expect(path.isAbsolute(item.path)).toBe(true);
  });

  test('[RED-05] deve incluir nome do arquivo e tamanho em bytes para cada item', async () => {
    await writeMinimalPdf(tempDir, 'doc.pdf');
    const [item] = await listPdfs(tempDir);

    expect(item.name).toBe('doc.pdf');
    expect(typeof item.sizeBytes).toBe('number');
    expect(item.sizeBytes).toBeGreaterThan(0);
  });

  test('[RED-06] deve ordenar os resultados por nome de arquivo (ascendente)', async () => {
    await writeMinimalPdf(tempDir, 'zeta.pdf');
    await writeMinimalPdf(tempDir, 'alpha.pdf');
    await writeMinimalPdf(tempDir, 'beta.pdf');

    const result = await listPdfs(tempDir);
    expect(result.map((item) => item.name)).toEqual(['alpha.pdf', 'beta.pdf', 'zeta.pdf']);
  });

  test('[RED-07] deve lançar erro tipado (ScannerError) se o path for nulo ou undefined', async () => {
    await expect(listPdfs(null)).rejects.toThrow(ScannerError);
    await expect(listPdfs(undefined)).rejects.toThrow(ScannerError);
  });

  test('[RED-08] deve ignorar subdiretórios (não recursivo por padrão)', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    await fs.mkdir(nestedDir);
    await writeMinimalPdf(tempDir, 'root.pdf');
    await writeMinimalPdf(nestedDir, 'nested.pdf');

    const result = await listPdfs(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('root.pdf');
  });

  test('[RED-09] deve aceitar opção { recursive: true } para busca em subpastas', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    await fs.mkdir(nestedDir);
    await writeMinimalPdf(tempDir, 'root.pdf');
    await writeMinimalPdf(nestedDir, 'nested.pdf');

    const result = await listPdfs(tempDir, { recursive: true });
    expect(result.map((item) => item.name).sort()).toEqual(['nested.pdf', 'root.pdf']);
  });
});
