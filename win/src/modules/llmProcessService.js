const fs = require('fs/promises');
const path = require('path');
const { createLlmAdapter } = require('../adapters/llmAdapter');
const { extractSummary, parseStructuredData } = require('./summaryExtractor');
const { nowIso } = require('../adapters/persistenceMappers');

const DEFAULT_PROMPT =
  'Analyze the content below and respond with valid JSON containing at least a "summary" field and optional structured "data".';

function buildPrompt(promptTemplate, content) {
  const template = promptTemplate?.trim() || DEFAULT_PROMPT;
  return `${template}\n\n---\n\n${content}`;
}

function buildResponseFileName(jobId) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `llm_response_${stamp}_${jobId.slice(0, 8)}.json`;
}

// baseUrl pode ser uma função: com porta efêmera (port: 0) a URL real só é
// conhecida depois que o servidor começa a escutar.
function resolveBaseUrl(baseUrl) {
  const resolved = typeof baseUrl === 'function' ? baseUrl() : baseUrl;
  return String(resolved ?? '').replace(/\/$/, '');
}

function buildOpenUrl(baseUrl, fileName) {
  return `${resolveBaseUrl(baseUrl)}/open/${encodeURIComponent(fileName)}`;
}

function createLlmProcessService({
  persistence,
  modelService,
  outputDir = './output',
  baseUrl = 'http://127.0.0.1:4000',
  fileReader = require('../adapters/fileReaderAdapter'),
  createLlmAdapterFn = createLlmAdapter,
  logger = null,
}) {
  async function processRequest(input) {
    const userId = input.userId;
    if (!userId) {
      const error = new Error('userId is required');
      error.statusCode = 400;
      throw error;
    }

    const modelConfig = await modelService.getModelConfig(input.llmModelId, userId);
    if (!modelConfig) {
      const error = new Error('LLM model not found');
      error.statusCode = 404;
      throw error;
    }

    const effectiveOutputDir = input.outputDir || outputDir;
    const fileData = await fileReader.readFileContent(input.sourceFile, effectiveOutputDir);
    const prompt = buildPrompt(input.promptTemplate, fileData.content);

    const job = await persistence.createLlmJob({
      userId,
      llmModelId: input.llmModelId,
      sourceFile: input.sourceFile,
      sourceType: fileData.sourceType,
      promptTemplate: input.promptTemplate ?? null,
      status: 'running',
    });

    try {
      const adapter = createLlmAdapterFn(modelConfig.provider);
      const llmResult = await adapter.complete({
        modelId: modelConfig.modelId,
        prompt,
        maxTokens: input.options?.maxTokens,
        temperature: input.options?.temperature,
        config: {
          baseUrl: modelConfig.baseUrl,
          token: modelConfig.token,
        },
      });

      const summary = extractSummary(llmResult.content);
      const structured = parseStructuredData(llmResult.content);
      const responseFileName = buildResponseFileName(job.id);
      const responsePayload = {
        meta: {
          jobId: job.id,
          llmModelId: modelConfig.id,
          provider: modelConfig.provider,
          modelId: modelConfig.modelId,
          sourceFile: input.sourceFile,
          processedAt: nowIso(),
        },
        summary,
        data: structured && typeof structured === 'object' ? structured : {},
        raw: llmResult.raw,
      };

      await fs.mkdir(path.resolve(effectiveOutputDir), { recursive: true });
      await fs.writeFile(
        path.join(path.resolve(effectiveOutputDir), responseFileName),
        JSON.stringify(responsePayload, null, 2),
        'utf8',
      );

      const completedAt = nowIso();
      const updatedJob = await persistence.updateLlmJob(
        job.id,
        {
          status: 'completed',
          responseFile: responseFileName,
          summary,
          completedAt,
        },
        userId,
      );

      logger?.info?.('LLM process completed', {
        jobId: job.id,
        responseFile: responseFileName,
      });

      return {
        jobId: job.id,
        status: updatedJob.status,
        responseFile: responseFileName,
        responseUrl: buildOpenUrl(baseUrl, responseFileName),
        summary,
        usage: llmResult.usage,
      };
    } catch (error) {
      await persistence.updateLlmJob(
        job.id,
        {
          status: 'failed',
          errorMessage: error.message,
          completedAt: nowIso(),
        },
        userId,
      );

      logger?.error?.('LLM process failed', error);

      const wrapped = new Error(error.message || 'LLM processing failed');
      wrapped.statusCode = error.statusCode || 502;
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function getJob(id, userId) {
    if (!userId) {
      const error = new Error('userId is required');
      error.statusCode = 400;
      throw error;
    }

    const job = await persistence.getLlmJob(id, userId);
    if (!job) {
      return null;
    }

    return {
      ...job,
      responseUrl: job.responseFile ? buildOpenUrl(baseUrl, job.responseFile) : null,
    };
  }

  async function listJobs(filter = {}, userId) {
    if (!userId) {
      const error = new Error('userId is required');
      error.statusCode = 400;
      throw error;
    }

    const jobs = await persistence.listLlmJobs({ ...filter, userId });
    return jobs.map((job) => ({
      ...job,
      responseUrl: job.responseFile ? buildOpenUrl(baseUrl, job.responseFile) : null,
    }));
  }

  return {
    processRequest,
    getJob,
    listJobs,
    buildPrompt,
  };
}

module.exports = {
  createLlmProcessService,
  DEFAULT_PROMPT,
};
