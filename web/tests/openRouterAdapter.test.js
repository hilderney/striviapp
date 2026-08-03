const { OpenRouterAdapter } = require('../src/adapters/openRouterAdapter');
const { LlmError } = require('../src/errors');

function mockFetch(handler) {
  return jest.fn(async (url, options) => handler(url, options));
}

describe('openRouterAdapter', () => {
  test('[F2-20] complete deve enviar Authorization Bearer', async () => {
    const fetchImpl = mockFetch(async (url, options) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(options.headers.Authorization).toBe('Bearer sk-test');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      };
    });

    const adapter = new OpenRouterAdapter({ fetchImpl });
    const result = await adapter.complete({
      modelId: 'openai/gpt-4o-mini',
      prompt: 'hello',
      config: { token: 'sk-test' },
    });

    expect(result.content).toBe('result');
  });

  test('[F2-21] deve mapear usage (prompt_tokens, completion_tokens)', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    }));

    const adapter = new OpenRouterAdapter({ fetchImpl });
    const result = await adapter.complete({
      modelId: 'openai/gpt-4o-mini',
      prompt: 'hello',
      config: { token: 'sk-test' },
    });

    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });

  test('[F2-22] erro 401 deve lançar LlmError com código UNAUTHORIZED', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));

    const adapter = new OpenRouterAdapter({ fetchImpl });
    await expect(
      adapter.complete({
        modelId: 'openai/gpt-4o-mini',
        prompt: 'hello',
        config: { token: 'bad' },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
  });

  test('[F2-23] listModels deve chamar /models (ou usar modelId do CRUD)', async () => {
    const fetchImpl = mockFetch(async (url, options) => {
      expect(url).toBe('https://openrouter.ai/api/v1/models');
      expect(options.headers.Authorization).toBe('Bearer sk-test');
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }] }),
      };
    });

    const adapter = new OpenRouterAdapter({ fetchImpl });
    const models = await adapter.listModels({ token: 'sk-test' });
    expect(models[0].id).toBe('openai/gpt-4o-mini');
  });
});
