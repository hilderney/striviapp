const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { PersistenceAdapter } = require('./persistenceAdapter');
const { PersistenceError } = require('../errors');
const { toModelDto, toJobDto, nowIso } = require('./persistenceMappers');

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(512) NOT NULL,
    role ENUM('ADM', 'USER') NOT NULL,
    totp_secret_encrypted TEXT,
    totp_pending_secret_encrypted TEXT,
    totp_enabled TINYINT NOT NULL DEFAULT 0,
    subscription_status ENUM('active', 'expired', 'none') NOT NULL DEFAULT 'none',
    subscription_expires_at VARCHAR(64) NULL,
    subscription_plan VARCHAR(64) NULL,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    expires_at VARCHAR(64) NOT NULL,
    revoked_at VARCHAR(64) NULL,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_refresh_user (user_id),
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS llm_models (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    model_id VARCHAR(255) NOT NULL,
    base_url VARCHAR(512) NULL,
    token_encrypted TEXT,
    is_default TINYINT NOT NULL DEFAULT 0,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    INDEX idx_llm_models_user (user_id),
    CONSTRAINT fk_models_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS llm_jobs (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    llm_model_id CHAR(36) NOT NULL,
    source_file VARCHAR(512) NOT NULL,
    source_type VARCHAR(64) NOT NULL,
    prompt_template TEXT,
    status VARCHAR(32) NOT NULL,
    response_file VARCHAR(512) NULL,
    summary TEXT,
    error_message TEXT,
    created_at VARCHAR(64) NOT NULL,
    completed_at VARCHAR(64) NULL,
    INDEX idx_llm_jobs_user_created (user_id, created_at),
    CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_jobs_model FOREIGN KEY (llm_model_id) REFERENCES llm_models(id)
  )`,
];

class MysqlPersistenceAdapter extends PersistenceAdapter {
  constructor(options = {}) {
    super();
    this.options = {
      host: options.host ?? '127.0.0.1',
      port: Number(options.port ?? 3306),
      user: options.user ?? 'root',
      password: options.password ?? '',
      database: options.database ?? 'striviapp',
      waitForConnections: true,
      connectionLimit: options.connectionLimit ?? 10,
    };
    this.pool = null;
  }

  async init() {
    try {
      this.pool = mysql.createPool(this.options);
      for (const statement of SCHEMA_STATEMENTS) {
        await this.pool.query(statement);
      }
      await this._migrateTotpPendingColumn();
    } catch (error) {
      throw new PersistenceError('Failed to initialize MySQL persistence', error);
    }
  }

  // MySQL 8 não tem ADD COLUMN IF NOT EXISTS: checar o catálogo é o único jeito idempotente.
  async _migrateTotpPendingColumn() {
    const [rows] = await this.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'users'
         AND column_name = 'totp_pending_secret_encrypted'`,
    );
    if (rows.length === 0) {
      await this.pool.query('ALTER TABLE users ADD COLUMN totp_pending_secret_encrypted TEXT');
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  _ensurePool() {
    if (!this.pool) {
      throw new PersistenceError('MySQL adapter not initialized');
    }
  }

  async _clearOtherDefaults(userId, exceptId) {
    if (exceptId) {
      await this.pool.execute(
        'UPDATE llm_models SET is_default = 0, updated_at = ? WHERE user_id = ? AND id != ?',
        [nowIso(), userId, exceptId],
      );
    } else {
      await this.pool.execute(
        'UPDATE llm_models SET is_default = 0, updated_at = ? WHERE user_id = ?',
        [nowIso(), userId],
      );
    }
  }

  async createLlmModel(data) {
    this._ensurePool();
    if (!data.userId) {
      throw new PersistenceError('userId is required to create LLM model');
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    if (data.isDefault) {
      await this._clearOtherDefaults(data.userId, null);
    }
    try {
      await this.pool.execute(
        `INSERT INTO llm_models
        (id, user_id, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.userId,
          data.name,
          data.provider,
          data.modelId,
          data.baseUrl ?? null,
          data.tokenEncrypted ?? null,
          data.isDefault ? 1 : 0,
          timestamp,
          timestamp,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM model', error);
    }
    return this.getLlmModel(id, data.userId);
  }

  async getLlmModel(id, userId = null) {
    this._ensurePool();
    const [rows] = userId
      ? await this.pool.execute('SELECT * FROM llm_models WHERE id = ? AND user_id = ?', [
          id,
          userId,
        ])
      : await this.pool.execute('SELECT * FROM llm_models WHERE id = ?', [id]);
    return toModelDto(rows[0] ?? null);
  }

  async getLlmModelRaw(id, userId = null) {
    this._ensurePool();
    const [rows] = userId
      ? await this.pool.execute('SELECT * FROM llm_models WHERE id = ? AND user_id = ?', [
          id,
          userId,
        ])
      : await this.pool.execute('SELECT * FROM llm_models WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async listLlmModels(filter = {}) {
    this._ensurePool();
    if (!filter.userId) {
      throw new PersistenceError('userId is required to list LLM models');
    }
    const [rows] = filter.provider
      ? await this.pool.execute(
          'SELECT * FROM llm_models WHERE user_id = ? AND provider = ? ORDER BY name ASC',
          [filter.userId, filter.provider],
        )
      : await this.pool.execute(
          'SELECT * FROM llm_models WHERE user_id = ? ORDER BY name ASC',
          [filter.userId],
        );
    return rows.map(toModelDto);
  }

  async updateLlmModel(id, data, userId = null) {
    this._ensurePool();
    const existing = await this.getLlmModelRaw(id, userId);
    if (!existing) {
      return null;
    }
    if (data.isDefault) {
      await this._clearOtherDefaults(existing.user_id, id);
    }
    try {
      await this.pool.execute(
        `UPDATE llm_models SET
          name = ?, provider = ?, model_id = ?, base_url = ?,
          token_encrypted = ?, is_default = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
        [
          data.name ?? existing.name,
          data.provider ?? existing.provider,
          data.modelId ?? existing.model_id,
          data.baseUrl !== undefined ? data.baseUrl : existing.base_url,
          data.tokenEncrypted !== undefined ? data.tokenEncrypted : existing.token_encrypted,
          data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
          nowIso(),
          id,
          existing.user_id,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM model', error);
    }
    return this.getLlmModel(id, existing.user_id);
  }

  async deleteLlmModel(id, userId = null) {
    this._ensurePool();
    const [result] = userId
      ? await this.pool.execute('DELETE FROM llm_models WHERE id = ? AND user_id = ?', [
          id,
          userId,
        ])
      : await this.pool.execute('DELETE FROM llm_models WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async createLlmJob(data) {
    this._ensurePool();
    if (!data.userId) {
      throw new PersistenceError('userId is required to create LLM job');
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    try {
      await this.pool.execute(
        `INSERT INTO llm_jobs
        (id, user_id, llm_model_id, source_file, source_type, prompt_template, status,
         response_file, summary, error_message, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.userId,
          data.llmModelId,
          data.sourceFile,
          data.sourceType,
          data.promptTemplate ?? null,
          data.status ?? 'pending',
          data.responseFile ?? null,
          data.summary ?? null,
          data.errorMessage ?? null,
          timestamp,
          data.completedAt ?? null,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM job', error);
    }
    return this.getLlmJob(id, data.userId);
  }

  async getLlmJob(id, userId = null) {
    this._ensurePool();
    const [rows] = userId
      ? await this.pool.execute('SELECT * FROM llm_jobs WHERE id = ? AND user_id = ?', [
          id,
          userId,
        ])
      : await this.pool.execute('SELECT * FROM llm_jobs WHERE id = ?', [id]);
    return toJobDto(rows[0] ?? null);
  }

  async listLlmJobs(filter = {}) {
    this._ensurePool();
    if (!filter.userId) {
      throw new PersistenceError('userId is required to list LLM jobs');
    }
    let rows;
    if (filter.llmModelId && filter.status) {
      [rows] = await this.pool.execute(
        `SELECT * FROM llm_jobs WHERE user_id = ? AND llm_model_id = ? AND status = ?
         ORDER BY created_at DESC`,
        [filter.userId, filter.llmModelId, filter.status],
      );
    } else if (filter.llmModelId) {
      [rows] = await this.pool.execute(
        'SELECT * FROM llm_jobs WHERE user_id = ? AND llm_model_id = ? ORDER BY created_at DESC',
        [filter.userId, filter.llmModelId],
      );
    } else if (filter.status) {
      [rows] = await this.pool.execute(
        'SELECT * FROM llm_jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [filter.userId, filter.status],
      );
    } else {
      [rows] = await this.pool.execute(
        'SELECT * FROM llm_jobs WHERE user_id = ? ORDER BY created_at DESC',
        [filter.userId],
      );
    }
    return rows.map(toJobDto);
  }

  async updateLlmJob(id, data, userId = null) {
    this._ensurePool();
    const [existingRows] = userId
      ? await this.pool.execute('SELECT * FROM llm_jobs WHERE id = ? AND user_id = ?', [
          id,
          userId,
        ])
      : await this.pool.execute('SELECT * FROM llm_jobs WHERE id = ?', [id]);
    const existing = existingRows[0];
    if (!existing) {
      return null;
    }
    try {
      await this.pool.execute(
        `UPDATE llm_jobs SET status = ?, response_file = ?, summary = ?,
         error_message = ?, completed_at = ? WHERE id = ? AND user_id = ?`,
        [
          data.status ?? existing.status,
          data.responseFile !== undefined ? data.responseFile : existing.response_file,
          data.summary !== undefined ? data.summary : existing.summary,
          data.errorMessage !== undefined ? data.errorMessage : existing.error_message,
          data.completedAt !== undefined ? data.completedAt : existing.completed_at,
          id,
          existing.user_id,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM job', error);
    }
    return this.getLlmJob(id, existing.user_id);
  }

  async countActiveJobsForModel(modelId, userId = null) {
    this._ensurePool();
    const [rows] = userId
      ? await this.pool.execute(
          `SELECT COUNT(*) AS count FROM llm_jobs
           WHERE llm_model_id = ? AND user_id = ? AND status IN ('pending', 'running')`,
          [modelId, userId],
        )
      : await this.pool.execute(
          `SELECT COUNT(*) AS count FROM llm_jobs
           WHERE llm_model_id = ? AND status IN ('pending', 'running')`,
          [modelId],
        );
    return Number(rows[0]?.count ?? 0);
  }

  async createUser(data) {
    this._ensurePool();
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const subscriptionStatus =
      data.subscriptionStatus ?? (data.role === 'ADM' ? 'active' : 'none');
    try {
      await this.pool.execute(
        `INSERT INTO users
        (id, username, password_hash, role, totp_secret_encrypted,
         totp_pending_secret_encrypted, totp_enabled,
         subscription_status, subscription_expires_at, subscription_plan, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.username,
          data.passwordHash,
          data.role,
          data.totpSecretEncrypted ?? null,
          data.totpPendingSecretEncrypted ?? null,
          data.totpEnabled ? 1 : 0,
          subscriptionStatus,
          data.subscriptionExpiresAt ?? null,
          data.subscriptionPlan ?? null,
          timestamp,
          timestamp,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to create user', error);
    }
    return this.getUserById(id);
  }

  async getUserById(id) {
    this._ensurePool();
    const [rows] = await this.pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async getUserByUsername(username) {
    this._ensurePool();
    const [rows] = await this.pool.execute('SELECT * FROM users WHERE username = ?', [
      username,
    ]);
    return rows[0] ?? null;
  }

  async updateUser(id, data) {
    this._ensurePool();
    const existing = await this.getUserById(id);
    if (!existing) {
      return null;
    }
    try {
      await this.pool.execute(
        `UPDATE users SET
          password_hash = ?, role = ?, totp_secret_encrypted = ?,
          totp_pending_secret_encrypted = ?, totp_enabled = ?,
          subscription_status = ?, subscription_expires_at = ?, subscription_plan = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          data.passwordHash ?? existing.password_hash,
          data.role ?? existing.role,
          data.totpSecretEncrypted !== undefined
            ? data.totpSecretEncrypted
            : existing.totp_secret_encrypted,
          data.totpPendingSecretEncrypted !== undefined
            ? data.totpPendingSecretEncrypted
            : existing.totp_pending_secret_encrypted,
          data.totpEnabled !== undefined ? (data.totpEnabled ? 1 : 0) : existing.totp_enabled,
          data.subscriptionStatus ?? existing.subscription_status ?? 'none',
          data.subscriptionExpiresAt !== undefined
            ? data.subscriptionExpiresAt
            : existing.subscription_expires_at,
          data.subscriptionPlan !== undefined
            ? data.subscriptionPlan
            : existing.subscription_plan,
          nowIso(),
          id,
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to update user', error);
    }
    return this.getUserById(id);
  }

  async listUsers() {
    this._ensurePool();
    const [rows] = await this.pool.execute('SELECT * FROM users ORDER BY username ASC');
    return rows;
  }

  async countUsers() {
    this._ensurePool();
    const [rows] = await this.pool.execute('SELECT COUNT(*) AS count FROM users');
    return Number(rows[0]?.count ?? 0);
  }

  async insertRefreshToken(data) {
    this._ensurePool();
    try {
      await this.pool.execute(
        `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
        [data.tokenHash, data.userId, data.expiresAt, nowIso()],
      );
    } catch (error) {
      throw new PersistenceError('Failed to store refresh token', error);
    }
  }

  async getRefreshToken(tokenHash) {
    this._ensurePool();
    const [rows] = await this.pool.execute(
      'SELECT * FROM refresh_tokens WHERE token_hash = ?',
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async revokeRefreshToken(tokenHash) {
    this._ensurePool();
    const [result] = await this.pool.execute(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [nowIso(), tokenHash],
    );
    return result.affectedRows > 0;
  }
}

module.exports = {
  MysqlPersistenceAdapter,
};
