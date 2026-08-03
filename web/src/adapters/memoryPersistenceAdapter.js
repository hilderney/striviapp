const crypto = require('crypto');
const { PersistenceAdapter } = require('./persistenceAdapter');
const { toModelDto, toJobDto, nowIso } = require('./persistenceMappers');

class InMemoryPersistenceAdapter extends PersistenceAdapter {
  constructor() {
    super();
    this.models = new Map();
    this.jobs = new Map();
    this.users = new Map();
    this.refreshTokens = new Map();
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
  }

  async close() {
    this.models.clear();
    this.jobs.clear();
    this.users.clear();
    this.refreshTokens.clear();
    this.initialized = false;
  }

  _ensureInit() {
    if (!this.initialized) {
      throw new Error('Persistence adapter not initialized');
    }
  }

  _clearOtherDefaults(userId, exceptId) {
    for (const model of this.models.values()) {
      if (model.user_id === userId && model.id !== exceptId && model.is_default) {
        model.is_default = 0;
        model.updated_at = nowIso();
      }
    }
  }

  async createLlmModel(data) {
    this._ensureInit();
    if (!data.userId) {
      throw new Error('userId is required to create LLM model');
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();

    if (data.isDefault) {
      this._clearOtherDefaults(data.userId, null);
    }

    const row = {
      id,
      user_id: data.userId,
      name: data.name,
      provider: data.provider,
      model_id: data.modelId,
      base_url: data.baseUrl ?? null,
      token_encrypted: data.tokenEncrypted ?? null,
      is_default: data.isDefault ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.models.set(id, row);
    return toModelDto(row);
  }

  async getLlmModel(id, userId = null) {
    this._ensureInit();
    const row = this.models.get(id);
    if (!row) {
      return null;
    }
    if (userId && row.user_id !== userId) {
      return null;
    }
    return toModelDto(row);
  }

  getLlmModelRaw(id, userId = null) {
    this._ensureInit();
    const row = this.models.get(id) ?? null;
    if (!row) {
      return null;
    }
    if (userId && row.user_id !== userId) {
      return null;
    }
    return row;
  }

  async listLlmModels(filter = {}) {
    this._ensureInit();
    if (!filter.userId) {
      throw new Error('userId is required to list LLM models');
    }

    let rows = [...this.models.values()].filter((row) => row.user_id === filter.userId);
    if (filter.provider) {
      rows = rows.filter((row) => row.provider === filter.provider);
    }
    return rows.map(toModelDto).sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateLlmModel(id, data, userId = null) {
    this._ensureInit();
    const existing = this.getLlmModelRaw(id, userId);
    if (!existing) {
      return null;
    }

    if (data.isDefault) {
      this._clearOtherDefaults(existing.user_id, id);
    }

    const updated = {
      ...existing,
      name: data.name ?? existing.name,
      provider: data.provider ?? existing.provider,
      model_id: data.modelId ?? existing.model_id,
      base_url: data.baseUrl !== undefined ? data.baseUrl : existing.base_url,
      token_encrypted:
        data.tokenEncrypted !== undefined ? data.tokenEncrypted : existing.token_encrypted,
      is_default: data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
      updated_at: nowIso(),
    };

    this.models.set(id, updated);
    return toModelDto(updated);
  }

  async deleteLlmModel(id, userId = null) {
    this._ensureInit();
    const existing = this.getLlmModelRaw(id, userId);
    if (!existing) {
      return false;
    }
    return this.models.delete(id);
  }

  async createLlmJob(data) {
    this._ensureInit();
    if (!data.userId) {
      throw new Error('userId is required to create LLM job');
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();

    const row = {
      id,
      user_id: data.userId,
      llm_model_id: data.llmModelId,
      source_file: data.sourceFile,
      source_type: data.sourceType,
      prompt_template: data.promptTemplate ?? null,
      status: data.status ?? 'pending',
      response_file: data.responseFile ?? null,
      summary: data.summary ?? null,
      error_message: data.errorMessage ?? null,
      created_at: timestamp,
      completed_at: data.completedAt ?? null,
    };

    this.jobs.set(id, row);
    return toJobDto(row);
  }

  async getLlmJob(id, userId = null) {
    this._ensureInit();
    const row = this.jobs.get(id);
    if (!row) {
      return null;
    }
    if (userId && row.user_id !== userId) {
      return null;
    }
    return toJobDto(row);
  }

  async listLlmJobs(filter = {}) {
    this._ensureInit();
    if (!filter.userId) {
      throw new Error('userId is required to list LLM jobs');
    }

    let rows = [...this.jobs.values()].filter((row) => row.user_id === filter.userId);

    if (filter.llmModelId) {
      rows = rows.filter((row) => row.llm_model_id === filter.llmModelId);
    }
    if (filter.status) {
      rows = rows.filter((row) => row.status === filter.status);
    }

    return rows.map(toJobDto).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateLlmJob(id, data, userId = null) {
    this._ensureInit();
    const existing = this.jobs.get(id);
    if (!existing || (userId && existing.user_id !== userId)) {
      return null;
    }

    const updated = {
      ...existing,
      status: data.status ?? existing.status,
      response_file: data.responseFile !== undefined ? data.responseFile : existing.response_file,
      summary: data.summary !== undefined ? data.summary : existing.summary,
      error_message: data.errorMessage !== undefined ? data.errorMessage : existing.error_message,
      completed_at: data.completedAt !== undefined ? data.completedAt : existing.completed_at,
    };

    this.jobs.set(id, updated);
    return toJobDto(updated);
  }

  async countActiveJobsForModel(modelId, userId = null) {
    this._ensureInit();
    return [...this.jobs.values()].filter(
      (job) =>
        job.llm_model_id === modelId &&
        (!userId || job.user_id === userId) &&
        ['pending', 'running'].includes(job.status),
    ).length;
  }

  async createUser(data) {
    this._ensureInit();
    if ([...this.users.values()].some((user) => user.username === data.username)) {
      throw new Error(`User already exists: ${data.username}`);
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const row = {
      id,
      username: data.username,
      password_hash: data.passwordHash,
      role: data.role,
      totp_secret_encrypted: data.totpSecretEncrypted ?? null,
      totp_pending_secret_encrypted: data.totpPendingSecretEncrypted ?? null,
      totp_enabled: data.totpEnabled ? 1 : 0,
      subscription_status:
        data.subscriptionStatus ?? (data.role === 'ADM' ? 'active' : 'none'),
      subscription_expires_at:
        data.subscriptionExpiresAt !== undefined ? data.subscriptionExpiresAt : null,
      subscription_plan: data.subscriptionPlan ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.users.set(id, row);
    return row;
  }

  async getUserById(id) {
    this._ensureInit();
    return this.users.get(id) ?? null;
  }

  async getUserByUsername(username) {
    this._ensureInit();
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async updateUser(id, data) {
    this._ensureInit();
    const existing = this.users.get(id);
    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      password_hash: data.passwordHash ?? existing.password_hash,
      role: data.role ?? existing.role,
      totp_secret_encrypted:
        data.totpSecretEncrypted !== undefined
          ? data.totpSecretEncrypted
          : existing.totp_secret_encrypted,
      totp_pending_secret_encrypted:
        data.totpPendingSecretEncrypted !== undefined
          ? data.totpPendingSecretEncrypted
          : existing.totp_pending_secret_encrypted,
      totp_enabled:
        data.totpEnabled !== undefined ? (data.totpEnabled ? 1 : 0) : existing.totp_enabled,
      subscription_status: data.subscriptionStatus ?? existing.subscription_status ?? 'none',
      subscription_expires_at:
        data.subscriptionExpiresAt !== undefined
          ? data.subscriptionExpiresAt
          : existing.subscription_expires_at,
      subscription_plan:
        data.subscriptionPlan !== undefined ? data.subscriptionPlan : existing.subscription_plan,
      updated_at: nowIso(),
    };

    this.users.set(id, updated);
    return updated;
  }

  async listUsers() {
    this._ensureInit();
    return [...this.users.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  async countUsers() {
    this._ensureInit();
    return this.users.size;
  }

  async insertRefreshToken(data) {
    this._ensureInit();
    this.refreshTokens.set(data.tokenHash, {
      token_hash: data.tokenHash,
      user_id: data.userId,
      expires_at: data.expiresAt,
      revoked_at: null,
      created_at: nowIso(),
    });
  }

  async getRefreshToken(tokenHash) {
    this._ensureInit();
    return this.refreshTokens.get(tokenHash) ?? null;
  }

  async revokeRefreshToken(tokenHash) {
    this._ensureInit();
    const existing = this.refreshTokens.get(tokenHash);
    if (!existing || existing.revoked_at) {
      return false;
    }
    existing.revoked_at = nowIso();
    return true;
  }
}

module.exports = {
  InMemoryPersistenceAdapter,
};
