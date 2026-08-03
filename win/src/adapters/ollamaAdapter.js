const { LlmAdapter } = require('./llmAdapter');
const { LlmError } = require('../errors');

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 120000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new LlmError('LLM request timed out', { code: 'TIMEOUT', statusCode: 504, cause: error });
    }
    throw new LlmError('Failed to connect to Ollama', { code: 'CONNECTION_ERROR', statusCode: 502, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

class OllamaAdapter extends LlmAdapter {
  constructor(options = {}) {
    super();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  resolveBaseUrl(config = {}) {
    return (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async listModels(config = {}) {
    const baseUrl = this.resolveBaseUrl(config);
    const response = await this._request(`${baseUrl}/api/tags`, {}, config);

    const payload = await response.json();
    return (payload.models || []).map((model) => ({
      id: model.name,
      name: model.name,
      provider: 'ollama',
    }));
  }

  async complete(params) {
    const baseUrl = this.resolveBaseUrl(params.config);
    const response = await this._request(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.modelId,
          messages: [{ role: 'user', content: params.prompt }],
          stream: false,
          options: {
            temperature: params.temperature ?? 0.2,
            num_predict: params.maxTokens ?? 4096,
          },
        }),
      },
      params.config,
    );

    const payload = await response.json();
    const content = payload.message?.content ?? '';

    return {
      content,
      raw: payload,
      usage: {
        promptTokens: payload.prompt_eval_count ?? 0,
        completionTokens: payload.eval_count ?? 0,
      },
    };
  }

  async healthCheck(config = {}) {
    try {
      const baseUrl = this.resolveBaseUrl(config);
      const response = await this._request(`${baseUrl}/api/tags`, {}, config);
      return response.ok;
    } catch {
      return false;
    }
  }

  async _request(url, options = {}, config = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text();
        throw new LlmError(`Ollama request failed: ${response.status}`, {
          code: 'HTTP_ERROR',
          statusCode: response.status,
          cause: new Error(body),
        });
      }

      return response;
    } catch (error) {
      if (error instanceof LlmError) {
        throw error;
      }
      if (error.name === 'AbortError') {
        throw new LlmError('LLM request timed out', { code: 'TIMEOUT', statusCode: 504, cause: error });
      }
      throw new LlmError('Failed to connect to Ollama', {
        code: 'CONNECTION_ERROR',
        statusCode: 502,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  OllamaAdapter,
  fetchWithTimeout,
};
