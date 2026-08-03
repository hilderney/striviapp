const { createLlmAdapter } = require('../src/adapters/llmAdapter');
const { OllamaAdapter } = require('../src/adapters/ollamaAdapter');
const { OpenRouterAdapter } = require('../src/adapters/openRouterAdapter');

describe('llmAdapter factory', () => {
  test('createLlmAdapter retorna implementações conhecidas', () => {
    expect(createLlmAdapter('ollama')).toBeInstanceOf(OllamaAdapter);
    expect(createLlmAdapter('openrouter')).toBeInstanceOf(OpenRouterAdapter);
  });

  test('createLlmAdapter lança para tipo desconhecido', () => {
    expect(() => createLlmAdapter('unknown')).toThrow('Unknown LLM adapter');
  });
});
