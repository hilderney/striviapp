const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { readFileContent } = require('../src/adapters/fileReaderAdapter');
const { FileReaderError, ValidationError } = require('../src/errors');
const { createTempDir, writeTextFile } = require('./helpers/fixtures');

async function writeMinimalXlsx(dir, fileName, rows = [['a', 'b'], ['1', '2']]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  const filePath = path.join(dir, fileName);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

describe('fileReaderAdapter', () => {
  let outputDir;

  beforeEach(async () => {
    outputDir = await createTempDir('file-reader-');
    await writeTextFile(outputDir, 'sample.txt', 'hello txt');
    await writeTextFile(outputDir, 'sample.csv', 'a,b\n1,2');
    await writeMinimalXlsx(outputDir, 'sample.xlsx');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[F2-24] deve ler .txt como string UTF-8', async () => {
    const result = await readFileContent('sample.txt', outputDir);
    expect(result.content).toBe('hello txt');
    expect(result.sourceType).toBe('txt');
  });

  test('[F2-25] deve ler .csv e retornar texto tabular normalizado', async () => {
    const result = await readFileContent('sample.csv', outputDir);
    expect(result.content).toBe('a,b\n1,2');
    expect(result.sourceType).toBe('csv');
  });

  test('[F2-26] deve ler .xlsx e converter linhas em texto (via exceljs adapter Fase 1)', async () => {
    const result = await readFileContent('sample.xlsx', outputDir);
    expect(result.content).toContain('a\tb');
    expect(result.content).toContain('1\t2');
    expect(result.sourceType).toBe('xlsx');
  });

  test('[F2-27] deve rejeitar path fora de outputDir (path traversal)', async () => {
    await expect(readFileContent('../outside.txt', outputDir)).rejects.toThrow(FileReaderError);
  });

  test('[F2-28] deve lançar ValidationError para extensão não suportada', async () => {
    await writeTextFile(outputDir, 'sample.pdf', '%PDF');
    await expect(readFileContent('sample.pdf', outputDir)).rejects.toThrow(ValidationError);
  });
});
