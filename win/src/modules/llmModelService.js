const { ValidationError, CryptoError } = require('../errors');
const { createCryptoAdapter } = require('../adapters/cryptoAdapter');
const { createLlmAdapter } = require('../adapters/llmAdapter');

const VALID_PROVIDERS = new Set(['ollama', 'openrouter']);

const TOKEN_DECRYPT_HELP =
  'Token salvo não pôde ser lido. Defina APP_SECRET_KEY estável no .env e informe o token novamente em Editar.';

function createLlmModelService({ persistence, cryptoAdapter = createCryptoAdapter() }) {
  function decryptStoredToken(tokenEncrypted) {
    if (!tokenEncrypted) {
      return null;
    }

    try {
      return cryptoAdapter.decrypt(tokenEncrypted);
    } catch (error) {
      if (error instanceof CryptoError) {
        const decryptError = new ValidationError(TOKEN_DECRYPT_HELP);
        decryptError.code = 'TOKEN_DECRYPT_FAILED';
        decryptError.statusCode = 422;
        throw decryptError;
      }
      throw error;
    }
  }

  function validateProvider(provider) {
    if (!VALID_PROVIDERS.has(provider)) {
      throw new ValidationError(`Invalid provider: ${provider}`);
    }
  }

  function requireUserId(userId) {
    if (!userId) {
      const error = new ValidationError('userId is required');
      error.statusCode = 400;
      throw error;
    }
  }

  function toPublicDto(model) {
    if (!model) {
      return null;
    }
    return { ...model };
  }

  async function create(data, userId) {
    requireUserId(userId);
    validateProvider(data.provider);

    if (data.provider === 'openrouter' && !data.token) {
      throw new ValidationError('OpenRouter models require a token');
    }

    if (!data.name || !data.modelId) {
      throw new ValidationError('name and modelId are required');
    }

    const tokenEncrypted =
      data.provider === 'openrouter' && data.token ? cryptoAdapter.encrypt(data.token) : null;

    const model = await persistence.createLlmModel({
      userId,
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      baseUrl: data.baseUrl ?? null,
      tokenEncrypted,
      isDefault: Boolean(data.isDefault),
    });

    return toPublicDto(model);
  }

  async function get(id, userId) {
    requireUserId(userId);
    return toPublicDto(await persistence.getLlmModel(id, userId));
  }

  async function list(filter = {}, userId) {
    requireUserId(userId);
    const models = await persistence.listLlmModels({ ...filter, userId });
    return models.map(toPublicDto);
  }

  async function listForDropdown(userId) {
    requireUserId(userId);
    const models = await persistence.listLlmModels({ userId });
    return models.map(({ id, name, provider, isDefault }) => ({ id, name, provider, isDefault }));
  }

  async function update(id, data, userId) {
    requireUserId(userId);
    const existing = await persistence.getLlmModel(id, userId);
    if (!existing) {
      return null;
    }

    if (data.provider) {
      validateProvider(data.provider);
    }

    const provider = data.provider ?? existing.provider;
    if (provider === 'openrouter') {
      const willHaveToken =
        data.token !== undefined ? Boolean(data.token) : existing.hasToken;
      if (!willHaveToken) {
        throw new ValidationError('OpenRouter models require a token');
      }
    }

    const payload = {
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      baseUrl: data.baseUrl,
      isDefault: data.isDefault,
    };

    if (data.token !== undefined) {
      payload.tokenEncrypted =
        provider === 'openrouter' && data.token ? cryptoAdapter.encrypt(data.token) : null;
    }

    const updated = await persistence.updateLlmModel(id, payload, userId);
    return toPublicDto(updated);
  }

  async function remove(id, userId) {
    requireUserId(userId);
    const existing = await persistence.getLlmModel(id, userId);
    if (!existing) {
      return false;
    }

    const activeJobs = persistence.countActiveJobsForModel
      ? await persistence.countActiveJobsForModel(id, userId)
      : 0;

    if (activeJobs > 0) {
      const error = new ValidationError('Cannot delete model with active jobs');
      error.statusCode = 409;
      throw error;
    }

    return persistence.deleteLlmModel(id, userId);
  }

  async function healthCheck(id, userId) {
    requireUserId(userId);
    const model = await persistence.getLlmModel(id, userId);
    if (!model) {
      return { ok: false, error: 'Model not found' };
    }

    const raw = persistence.getLlmModelRaw
      ? await persistence.getLlmModelRaw(id, userId)
      : null;

    let token;
    try {
      token = decryptStoredToken(raw?.token_encrypted);
    } catch (error) {
      if (error.code === 'TOKEN_DECRYPT_FAILED') {
        return {
          ok: false,
          code: error.code,
          error: error.message,
          provider: model.provider,
          modelId: model.modelId,
        };
      }
      throw error;
    }

    const adapter = createLlmAdapter(model.provider);
    const ok = await adapter.healthCheck({
      baseUrl: model.baseUrl,
      token: token ?? undefined,
    });
    return { ok, provider: model.provider, modelId: model.modelId };
  }

  async function getModelConfig(id, userId) {
    requireUserId(userId);
    const model = await persistence.getLlmModel(id, userId);
    if (!model) {
      return null;
    }

    const raw = persistence.getLlmModelRaw
      ? await persistence.getLlmModelRaw(id, userId)
      : null;

    return {
      ...model,
      token: decryptStoredToken(raw?.token_encrypted),
    };
  }

  return {
    create,
    get,
    list,
    listForDropdown,
    update,
    remove,
    healthCheck,
    getModelConfig,
  };
}

module.exports = {
  createLlmModelService,
  VALID_PROVIDERS,
};
