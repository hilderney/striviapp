const fs = require('fs/promises');
const { LlmSummarizerBuilder } = require('../src/pipeline/LlmSummarizerBuilder');
const phase1Api = require('../src/api');
const { createTempDir } = require('./helpers/fixtures');

describe('LlmSummarizerBuilder', () => {
  let outputDir;
  let logsDir;
  let dbPath;
  let staticDir;

  beforeEach(async () => {
    outputDir = await createTempDir('llm-builder-output-');
    logsDir = await createTempDir('llm-builder-logs-');
    dbPath = `${await createTempDir('llm-builder-data-')}/app.db`;
    staticDir = await createTempDir('llm-builder-static-');
    await fs.writeFile(`${staticDir}/index.html`, '<html></html>');
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(logsDir, { recursive: true, force: true });
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  test('[F2-51] build() sem serve() deve criar app headless', async () => {
    const app = LlmSummarizerBuilder.create()
      .fromPhase1Api(phase1Api)
      .withPersistence('memory')
      .withoutServer()
      .build();

    await app.start();
    expect(app.url).toBeNull();
    expect(app.llmModelService).toBeTruthy();
    await app.close();
  });

  test('[F2-52] withPersistence("memory") deve injetar adapter nos services', async () => {
    const app = LlmSummarizerBuilder.create()
      .fromPhase1Api(phase1Api)
      .withPersistence('memory')
      .withoutServer()
      .build();

    await app.start();
    const model = await app.llmModelService.create({
      name: 'Test',
      provider: 'ollama',
      modelId: 'llama3',
    }, 'test-user-1');
    expect(model.id).toBeTruthy();
    await app.close();
  });

  test('[F2-53] registerLlmProviders deve registrar apenas tipos conhecidos', () => {
    expect(() =>
      LlmSummarizerBuilder.create().registerLlmProviders(['ollama', 'unknown']),
    ).toThrow('Unknown LLM provider');
  });

  test('[F2-54] start()/close() ciclo completo sem leak de handles', async () => {
    const app = LlmSummarizerBuilder.create()
      .fromPhase1Api(phase1Api)
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withPersistence('memory')
      .serve({ port: 0, host: '127.0.0.1', staticDir })
      .build();

    await app.start();
    expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await app.close();
    await app.close();
  });

  test('links de jobs usam a porta real quando serve({ port: 0 })', async () => {
    const app = LlmSummarizerBuilder.create()
      .fromPhase1Api(phase1Api)
      .outputTo(outputDir)
      .withLogs(logsDir)
      .withPersistence('memory')
      .serve({ port: 0, host: '127.0.0.1', staticDir })
      .build();

    await app.start();

    await app.persistence.createLlmJob({
      userId: 'test-user-1',
      llmModelId: 'model-1',
      sourceFile: 'relatorio.csv',
      sourceType: 'csv',
      status: 'completed',
      responseFile: 'llm_response_1.json',
    });

    const [job] = await app.llmProcessService.listJobs({}, 'test-user-1');
    expect(job.responseUrl).toBe(`${app.url}/open/llm_response_1.json`);
    expect(job.responseUrl).not.toContain(':0/');

    await app.close();
  });
});
