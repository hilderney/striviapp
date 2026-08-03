const fs = require('fs/promises');
const { createPersistenceAdapter } = require('../src/adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../src/adapters/cryptoAdapter');
const { createLlmModelService } = require('../src/modules/llmModelService');
const { createLlmProcessService } = require('../src/modules/llmProcessService');
const { createTempDir, writeTextFile } = require('./helpers/fixtures');

const TEST_KEY = Buffer.alloc(32, 5).toString('hex');

describe('llmProcessService', () => {
  let persistence;
  let modelService;
  let processService;
  let outputDir;
  let baseUrl;
  let modelId;
  let mockAdapter;
  let createLlmAdapterFn;

  beforeEach(async () => {
    outputDir = await createTempDir('llm-process-');
    baseUrl = 'http://127.0.0.1:9876';

    persistence = createPersistenceAdapter('memory');
    await persistence.init();

    modelService = createLlmModelService({
      persistence,
      cryptoAdapter: createCryptoAdapter({ secret: TEST_KEY }),
    });

    const model = await modelService.create({
      name: 'Ollama',
      provider: 'ollama',
      modelId: 'llama3',
    }, 'test-user-1');
    modelId = model.id;

    mockAdapter = {
      complete: jest.fn(async () => ({
        content: JSON.stringify({ summary: 'Processed summary', total: 2 }),
        raw: { message: { content: 'raw' } },
        usage: { promptTokens: 10, completionTokens: 5 },
      })),
    };

    createLlmAdapterFn = jest.fn(() => mockAdapter);

    processService = createLlmProcessService({
      persistence,
      modelService,
      outputDir,
      baseUrl,
      createLlmAdapterFn,
    });

    await writeTextFile(outputDir, 'input.txt', 'sample content');
  });

  afterEach(async () => {
    await persistence.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  test('[F2-34] deve ler sourceFile via fileReaderAdapter', async () => {
    const readFileContent = jest.fn(async () => ({
      content: 'sample content',
      sourceFile: 'input.txt',
      sourceType: 'txt',
      filePath: `${outputDir}/input.txt`,
    }));

    const localService = createLlmProcessService({
      persistence,
      modelService,
      outputDir,
      baseUrl,
      fileReader: { readFileContent },
      createLlmAdapterFn,
    });

    await localService.processRequest({ llmModelId: modelId, sourceFile: 'input.txt', userId: 'test-user-1' });
    expect(readFileContent).toHaveBeenCalledWith('input.txt', outputDir);
  });

  test('[F2-35] deve montar prompt final (template + conteúdo)', () => {
    const prompt = processService.buildPrompt('Custom instruction', 'body');
    expect(prompt).toContain('Custom instruction');
    expect(prompt).toContain('body');
  });

  test('[F2-36] deve chamar LlmAdapter correto conforme provider do modelo', async () => {
    await processService.processRequest({ llmModelId: modelId, sourceFile: 'input.txt', userId: 'test-user-1' });
    expect(createLlmAdapterFn).toHaveBeenCalledWith('ollama');
  });

  test('[F2-37] deve gravar JSON em output/ com nome llm_response_<timestamp>_<id>.json', async () => {
    const result = await processService.processRequest({
      userId: 'test-user-1',
      llmModelId: modelId,
      sourceFile: 'input.txt',
    });

    expect(result.responseFile).toMatch(/^llm_response_\d+_[a-f0-9]{8}\.json$/);

    const files = await fs.readdir(outputDir);
    expect(files.some((file) => file === result.responseFile)).toBe(true);
  });

  test('[F2-38] deve persistir job com status completed e summary', async () => {
    const result = await processService.processRequest({
      userId: 'test-user-1',
      llmModelId: modelId,
      sourceFile: 'input.txt',
    });

    const job = await persistence.getLlmJob(result.jobId);
    expect(job.status).toBe('completed');
    expect(job.summary).toBe('Processed summary');
  });

  test('[F2-39] falha LLM deve gravar job status=failed sem lançar (resposta API 502)', async () => {
    createLlmAdapterFn.mockReturnValue({
      complete: jest.fn(async () => {
        throw Object.assign(new Error('LLM down'), { statusCode: 502 });
      }),
    });

    await expect(
      processService.processRequest({ llmModelId: modelId, sourceFile: 'input.txt', userId: 'test-user-1' }),
    ).rejects.toMatchObject({ statusCode: 502 });

    const jobs = await persistence.listLlmJobs({ userId: 'test-user-1' });
    expect(jobs[0].status).toBe('failed');
  });

  test('[F2-40] responseUrl deve apontar para /open/<filename>', async () => {
    const result = await processService.processRequest({
      userId: 'test-user-1',
      llmModelId: modelId,
      sourceFile: 'input.txt',
    });

    expect(result.responseUrl).toBe(
      `${baseUrl}/open/${encodeURIComponent(result.responseFile)}`,
    );
  });
});
