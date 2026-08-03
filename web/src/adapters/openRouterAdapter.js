const { LlmAdapter } = require('./llmAdapter');
const { LlmError } = require('../errors');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120000;

class OpenRouterAdapter extends LlmAdapter {
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
    const response = await this._request(`${baseUrl}/models`, {}, config);

    const payload = await response.json();
    return (payload.data || []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: 'openrouter',
    }));
  }

  async complete(params) {
    const baseUrl = this.resolveBaseUrl(params.config);
    const response = await this._request(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.config.token}`,
        },
        body: JSON.stringify({
          model: params.modelId,
          messages: [{ role: 'user', content: params.prompt }],
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature ?? 0.2,
        }),
      },
      params.config,
    );

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content ?? '';

    return {
      content,
      raw: payload,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
      },
    };
  }

  async healthCheck(config = {}) {
    try {
      const baseUrl = this.resolveBaseUrl(config);
      const response = await this._request(`${baseUrl}/models`, {}, config);
      return response.ok;
    } catch {
      return false;
    }
  }

  async _request(url, options = {}, config = {}) {
    const headers = { ...(options.headers || {}) };

    if (config.token && !headers.Authorization) {
      headers.Authorization = `Bearer ${config.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new LlmError('OpenRouter unauthorized', {
          code: 'UNAUTHORIZED',
          statusCode: 401,
        });
      }

      if (!response.ok) {
        const body = await response.text();
        throw new LlmError(`OpenRouter request failed: ${response.status}`, {
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
      throw new LlmError('Failed to connect to OpenRouter', {
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
  OpenRouterAdapter,
};
