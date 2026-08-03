const fs = require('fs/promises');
const path = require('path');
const { extractText, extractBatch } = require('../src/modules/extractor');
const { ExtractionError } = require('../src/errors');
const { createTempDir, writeMinimalPdf, writeTextFile } = require('./helpers/fixtures');

describe('extractor', () => {
  let inputDir;
  let outputDir;

  beforeEach(async () => {
    inputDir = await createTempDir('extractor-input-');
    outputDir = await createTempDir('extractor-output-');
  });

  afterEach(async () => {
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[RED-10] deve extrair texto de um PDF válido e retornar string não vazia', async () => {
    const pdfPath = await writeMinimalPdf(inputDir, 'doc.pdf');
    const result = await extractText(pdfPath, outputDir, { overwrite: true });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('Hello PDF');
  });

  test('[RED-11] deve gerar arquivo .txt com sufixo _pdf no diretório de saída', async () => {
    const pdfPath = await writeMinimalPdf(inputDir, 'doc.pdf');
    const result = await extractText(pdfPath, outputDir, { overwrite: true });

    expect(result.outputFile).toBe(path.join(outputDir, 'doc_pdf.txt'));
    await expect(fs.access(result.outputFile)).resolves.toBeUndefined();
  });

  test('[RED-12] deve retornar metadados: { inputFile, outputFile, pageCount, charCount }', async () => {
    const pdfPath = await writeMinimalPdf(inputDir, 'doc.pdf');
    const result = await extractText(pdfPath, outputDir, { overwrite: true });

    expect(result).toMatchObject({
      inputFile: 'doc.pdf',
      outputFile: path.join(outputDir, 'doc_pdf.txt'),
      pageCount: expect.any(Number),
      charCount: expect.any(Number),
    });
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.charCount).toBe(result.text.length);
  });

  test('[RED-13] deve processar múltiplos PDFs em batch e retornar array de resultados', async () => {
    const pdfA = await writeMinimalPdf(inputDir, 'a.pdf');
    const pdfB = await writeMinimalPdf(inputDir, 'b.pdf');

    const batch = await extractBatch([pdfA, pdfB], outputDir, { overwrite: true });

    expect(batch.results).toHaveLength(2);
    expect(batch.errors).toHaveLength(0);
  });

  test('[RED-14] deve registrar erro individual sem interromper o batch (tolerância a falhas)', async () => {
    const validPdf = await writeMinimalPdf(inputDir, 'valid.pdf');
    const invalidPdf = await writeTextFile(inputDir, 'invalid.pdf', 'not a pdf');

    const batch = await extractBatch([validPdf, invalidPdf], outputDir, { overwrite: true });

    expect(batch.results).toHaveLength(1);
    expect(batch.errors).toHaveLength(1);
    expect(batch.errors[0].inputFile).toBe('invalid.pdf');
  });

  test('[RED-15] deve lançar ExtractionError se o arquivo não for um PDF válido', async () => {
    const fakePdf = await writeTextFile(inputDir, 'fake.pdf', 'not a pdf');

    await expect(extractText(fakePdf, outputDir)).rejects.toThrow(ExtractionError);
  });

  test('[RED-16] deve criar o diretório de saída se ele não existir', async () => {
    const pdfPath = await writeMinimalPdf(inputDir, 'doc.pdf');
    const nestedOutput = path.join(outputDir, 'nested', 'out');

    await extractText(pdfPath, nestedOutput, { overwrite: true });
    await expect(fs.access(nestedOutput)).resolves.toBeUndefined();
  });

  test('[RED-17] deve não sobrescrever arquivo .txt existente (a menos que { overwrite: true })', async () => {
    const pdfPath = await writeMinimalPdf(inputDir, 'doc.pdf');
    await extractText(pdfPath, outputDir, { overwrite: true });
    await fs.writeFile(path.join(outputDir, 'doc_pdf.txt'), 'existing', 'utf8');

    await expect(extractText(pdfPath, outputDir)).rejects.toThrow(ExtractionError);
    await expect(extractText(pdfPath, outputDir, { overwrite: true })).resolves.toBeDefined();
  });

  test('[RED-18] o arquivo .txt gerado deve preservar quebras de parágrafo do PDF original', async () => {
    const parserAdapter = {
      parse: async () => ({
        text: 'First paragraph.\n\nSecond paragraph.',
        pageCount: 1,
      }),
    };

    const pdfPath = await writeMinimalPdf(inputDir, 'paragraphs.pdf');
    const result = await extractText(pdfPath, outputDir, {
      overwrite: true,
      parserAdapter,
    });

    const saved = await fs.readFile(result.outputFile, 'utf8');
    expect(saved).toBe('First paragraph.\n\nSecond paragraph.');
  });
});
