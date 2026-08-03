const { OllamaAdapter } = require('../src/adapters/ollamaAdapter');
const { LlmError } = require('../src/errors');

function mockFetch(handler) {
  return jest.fn(async (url, options) => handler(url, options));
}

describe('ollamaAdapter', () => {
  test('[F2-16] listModels deve parsear resposta /api/tags', async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags');
      return {
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
      };
    });

    const adapter = new OllamaAdapter({ fetchImpl });
    const models = await adapter.listModels();
    expect(models).toEqual([
      { id: 'llama3', name: 'llama3', provider: 'ollama' },
      { id: 'mistral', name: 'mistral', provider: 'ollama' },
    ]);
  });

  test('[F2-17] complete deve enviar prompt e retornar content', async () => {
    const fetchImpl = mockFetch(async (url, options) => {
      expect(url).toBe('http://127.0.0.1:11434/api/chat');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('llama3');
      expect(body.messages[0].content).toBe('Analyze this');

      return {
        ok: true,
        json: async () => ({
          message: { content: '{"summary":"ok"}' },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      };
    });

    const adapter = new OllamaAdapter({ fetchImpl });
    const result = await adapter.complete({
      modelId: 'llama3',
      prompt: 'Analyze this',
      config: {},
    });

    expect(result.content).toBe('{"summary":"ok"}');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
  });

  test('[F2-18] healthCheck deve retornar true se /api/tags responde 200', async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, json: async () => ({ models: [] }) }));
    const adapter = new OllamaAdapter({ fetchImpl });
    await expect(adapter.healthCheck()).resolves.toBe(true);
  });

  test('[F2-19] deve lançar LlmError em timeout ou conexão recusada', async () => {
    const fetchImpl = jest.fn(async () => {
      const error = new Error('ECONNREFUSED');
      error.name = 'FetchError';
      throw error;
    });

    const adapter = new OllamaAdapter({ fetchImpl });
    await expect(adapter.complete({ modelId: 'llama3', prompt: 'x', config: {} })).rejects.toThrow(
      LlmError,
    );
  });
});
