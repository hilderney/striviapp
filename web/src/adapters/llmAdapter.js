class LlmAdapter {
  async listModels(_config) {
    throw new Error('LlmAdapter.listModels() must be implemented');
  }

  async complete(_params) {
    throw new Error('LlmAdapter.complete() must be implemented');
  }

  async healthCheck(_config) {
    throw new Error('LlmAdapter.healthCheck() must be implemented');
  }
}

function createLlmAdapter(type) {
  switch (type) {
    case 'ollama':
      return new (require('./ollamaAdapter').OllamaAdapter)();
    case 'openrouter':
      return new (require('./openRouterAdapter').OpenRouterAdapter)();
    default:
      throw new Error(`Unknown LLM adapter: ${type}`);
  }
}

module.exports = {
  LlmAdapter,
  createLlmAdapter,
};
