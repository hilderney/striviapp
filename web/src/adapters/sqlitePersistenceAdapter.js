const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { PersistenceAdapter } = require('./persistenceAdapter');
const { PersistenceError } = require('../errors');
const { toModelDto, toJobDto, nowIso } = require('./persistenceMappers');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADM', 'USER')),
  totp_secret_encrypted TEXT,
  totp_pending_secret_encrypted TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('active', 'expired', 'none')),
  subscription_expires_at TEXT,
  subscription_plan TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  base_url TEXT,
  token_encrypted TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS llm_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  llm_model_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_type TEXT NOT NULL,
  prompt_template TEXT,
  status TEXT NOT NULL,
  response_file TEXT,
  summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (llm_model_id) REFERENCES llm_models(id)
);

CREATE INDEX IF NOT EXISTS idx_llm_models_user ON llm_models(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_jobs_user_created ON llm_jobs(user_id, created_at);
`;

function tableHasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((col) => col.name === column);
}

function tableExists(db, table) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table),
  );
}

class SqlitePersistenceAdapter extends PersistenceAdapter {
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath ?? './data/app.db';
    this.db = null;
  }

  async init(options = {}) {
    if (options.dbPath) {
      this.dbPath = options.dbPath;
    }

    const dir = path.dirname(path.resolve(this.dbPath));
    fs.mkdirSync(dir, { recursive: true });

    try {
      this.db = new Database(this.dbPath);
      this._migrateLegacySchema();
      this.db.exec(SCHEMA);
      this._migrateSubscriptionColumns();
      this._migrateTotpPendingColumn();
      this._migrateOrphansAndSubscriptions();
    } catch (error) {
      throw new PersistenceError(`Failed to initialize SQLite at ${this.dbPath}`, error);
    }
  }

  // Bancos antigos sem user_id: recria tabelas com a coluna e copia dados.
  _migrateLegacySchema() {
    if (!tableExists(this.db, 'llm_models')) {
      return;
    }

    if (tableHasColumn(this.db, 'llm_models', 'user_id')) {
      return;
    }

    this.db.exec('ALTER TABLE llm_models RENAME TO llm_models_legacy');
    // Bancos da Fase 2 inicial podem ter llm_models sem nunca ter criado llm_jobs.
    if (tableExists(this.db, 'llm_jobs')) {
      this.db.exec('ALTER TABLE llm_jobs RENAME TO llm_jobs_legacy');
    }
  }

  _migrateSubscriptionColumns() {
    if (!tableHasColumn(this.db, 'users', 'subscription_status')) {
      this.db.exec(`
        ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE users ADD COLUMN subscription_expires_at TEXT;
        ALTER TABLE users ADD COLUMN subscription_plan TEXT;
      `);
    }
  }

  _migrateTotpPendingColumn() {
    if (!tableHasColumn(this.db, 'users', 'totp_pending_secret_encrypted')) {
      this.db.exec('ALTER TABLE users ADD COLUMN totp_pending_secret_encrypted TEXT');
    }
  }

  _migrateOrphansAndSubscriptions() {
    const adm = this.db
      .prepare("SELECT id FROM users WHERE role = 'ADM' ORDER BY created_at ASC LIMIT 1")
      .get();

    if (adm && tableExists(this.db, 'llm_models_legacy')) {
      this.db
        .prepare(
          `INSERT INTO llm_models
            (id, user_id, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at)
           SELECT id, ?, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at
           FROM llm_models_legacy`,
        )
        .run(adm.id);

      if (tableExists(this.db, 'llm_jobs_legacy')) {
        this.db
          .prepare(
            `INSERT INTO llm_jobs
              (id, user_id, llm_model_id, source_file, source_type, prompt_template, status,
               response_file, summary, error_message, created_at, completed_at)
             SELECT id, ?, llm_model_id, source_file, source_type, prompt_template, status,
                    response_file, summary, error_message, created_at, completed_at
             FROM llm_jobs_legacy`,
          )
          .run(adm.id);
        this.db.exec('DROP TABLE llm_jobs_legacy');
      }
      this.db.exec('DROP TABLE llm_models_legacy');
    }

    this.db
      .prepare(
        `UPDATE users SET subscription_status = 'active', subscription_expires_at = NULL
         WHERE role = 'ADM' AND (subscription_status IS NULL OR subscription_status = 'none')`,
      )
      .run();
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  _ensureDb() {
    if (!this.db) {
      throw new PersistenceError('SQLite adapter not initialized');
    }
  }

  _clearOtherDefaults(userId, exceptId) {
    if (exceptId) {
      this.db
        .prepare(
          'UPDATE llm_models SET is_default = 0, updated_at = ? WHERE user_id = ? AND id != ?',
        )
        .run(nowIso(), userId, exceptId);
    } else {
      this.db
        .prepare('UPDATE llm_models SET is_default = 0, updated_at = ? WHERE user_id = ?')
        .run(nowIso(), userId);
    }
  }

  async createLlmModel(data) {
    this._ensureDb();
    if (!data.userId) {
      throw new PersistenceError('userId is required to create LLM model');
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();

    if (data.isDefault) {
      this._clearOtherDefaults(data.userId, null);
    }

    try {
      this.db
        .prepare(
          `INSERT INTO llm_models
          (id, user_id, name, provider, model_id, base_url, token_encrypted, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM model', error);
    }

    return this.getLlmModel(id, data.userId);
  }

  async getLlmModel(id, userId = null) {
    this._ensureDb();
    let row;
    if (userId) {
      row = this.db
        .prepare('SELECT * FROM llm_models WHERE id = ? AND user_id = ?')
        .get(id, userId);
    } else {
      row = this.db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id);
    }
    return toModelDto(row);
  }

  getLlmModelRaw(id, userId = null) {
    this._ensureDb();
    if (userId) {
      return (
        this.db.prepare('SELECT * FROM llm_models WHERE id = ? AND user_id = ?').get(id, userId) ??
        null
      );
    }
    return this.db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id) ?? null;
  }

  async listLlmModels(filter = {}) {
    this._ensureDb();
    if (!filter.userId) {
      throw new PersistenceError('userId is required to list LLM models');
    }

    let rows;
    if (filter.provider) {
      rows = this.db
        .prepare(
          'SELECT * FROM llm_models WHERE user_id = ? AND provider = ? ORDER BY name ASC',
        )
        .all(filter.userId, filter.provider);
    } else {
      rows = this.db
        .prepare('SELECT * FROM llm_models WHERE user_id = ? ORDER BY name ASC')
        .all(filter.userId);
    }

    return rows.map(toModelDto);
  }

  async updateLlmModel(id, data, userId = null) {
    this._ensureDb();
    const existing = this.getLlmModelRaw(id, userId);
    if (!existing) {
      return null;
    }

    const ownerId = existing.user_id;
    if (data.isDefault) {
      this._clearOtherDefaults(ownerId, id);
    }

    try {
      this.db
        .prepare(
          `UPDATE llm_models SET
            name = ?,
            provider = ?,
            model_id = ?,
            base_url = ?,
            token_encrypted = ?,
            is_default = ?,
            updated_at = ?
          WHERE id = ? AND user_id = ?`,
        )
        .run(
          data.name ?? existing.name,
          data.provider ?? existing.provider,
          data.modelId ?? existing.model_id,
          data.baseUrl !== undefined ? data.baseUrl : existing.base_url,
          data.tokenEncrypted !== undefined ? data.tokenEncrypted : existing.token_encrypted,
          data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : existing.is_default,
          nowIso(),
          id,
          ownerId,
        );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM model', error);
    }

    return this.getLlmModel(id, ownerId);
  }

  async deleteLlmModel(id, userId = null) {
    this._ensureDb();
    const result = userId
      ? this.db.prepare('DELETE FROM llm_models WHERE id = ? AND user_id = ?').run(id, userId)
      : this.db.prepare('DELETE FROM llm_models WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async createLlmJob(data) {
    this._ensureDb();
    if (!data.userId) {
      throw new PersistenceError('userId is required to create LLM job');
    }

    const id = crypto.randomUUID();
    const timestamp = nowIso();

    try {
      this.db
        .prepare(
          `INSERT INTO llm_jobs
          (id, user_id, llm_model_id, source_file, source_type, prompt_template, status,
           response_file, summary, error_message, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
    } catch (error) {
      throw new PersistenceError('Failed to create LLM job', error);
    }

    return this.getLlmJob(id, data.userId);
  }

  async getLlmJob(id, userId = null) {
    this._ensureDb();
    let row;
    if (userId) {
      row = this.db.prepare('SELECT * FROM llm_jobs WHERE id = ? AND user_id = ?').get(id, userId);
    } else {
      row = this.db.prepare('SELECT * FROM llm_jobs WHERE id = ?').get(id);
    }
    return toJobDto(row);
  }

  async listLlmJobs(filter = {}) {
    this._ensureDb();
    if (!filter.userId) {
      throw new PersistenceError('userId is required to list LLM jobs');
    }

    let rows;
    if (filter.llmModelId && filter.status) {
      rows = this.db
        .prepare(
          `SELECT * FROM llm_jobs
           WHERE user_id = ? AND llm_model_id = ? AND status = ?
           ORDER BY created_at DESC`,
        )
        .all(filter.userId, filter.llmModelId, filter.status);
    } else if (filter.llmModelId) {
      rows = this.db
        .prepare(
          'SELECT * FROM llm_jobs WHERE user_id = ? AND llm_model_id = ? ORDER BY created_at DESC',
        )
        .all(filter.userId, filter.llmModelId);
    } else if (filter.status) {
      rows = this.db
        .prepare('SELECT * FROM llm_jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC')
        .all(filter.userId, filter.status);
    } else {
      rows = this.db
        .prepare('SELECT * FROM llm_jobs WHERE user_id = ? ORDER BY created_at DESC')
        .all(filter.userId);
    }

    return rows.map(toJobDto);
  }

  async updateLlmJob(id, data, userId = null) {
    this._ensureDb();
    const existing = userId
      ? this.db.prepare('SELECT * FROM llm_jobs WHERE id = ? AND user_id = ?').get(id, userId)
      : this.db.prepare('SELECT * FROM llm_jobs WHERE id = ?').get(id);
    if (!existing) {
      return null;
    }

    try {
      this.db
        .prepare(
          `UPDATE llm_jobs SET
            status = ?,
            response_file = ?,
            summary = ?,
            error_message = ?,
            completed_at = ?
          WHERE id = ? AND user_id = ?`,
        )
        .run(
          data.status ?? existing.status,
          data.responseFile !== undefined ? data.responseFile : existing.response_file,
          data.summary !== undefined ? data.summary : existing.summary,
          data.errorMessage !== undefined ? data.errorMessage : existing.error_message,
          data.completedAt !== undefined ? data.completedAt : existing.completed_at,
          id,
          existing.user_id,
        );
    } catch (error) {
      throw new PersistenceError('Failed to update LLM job', error);
    }

    return this.getLlmJob(id, existing.user_id);
  }

  async countActiveJobsForModel(modelId, userId = null) {
    this._ensureDb();
    const row = userId
      ? this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM llm_jobs
             WHERE llm_model_id = ? AND user_id = ? AND status IN ('pending', 'running')`,
          )
          .get(modelId, userId)
      : this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM llm_jobs
             WHERE llm_model_id = ? AND status IN ('pending', 'running')`,
          )
          .get(modelId);
    return row?.count ?? 0;
  }

  async createUser(data) {
    this._ensureDb();
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const role = data.role;
    const subscriptionStatus =
      data.subscriptionStatus ?? (role === 'ADM' ? 'active' : 'none');
    const subscriptionExpiresAt =
      data.subscriptionExpiresAt !== undefined
        ? data.subscriptionExpiresAt
        : role === 'ADM'
          ? null
          : null;

    try {
      this.db
        .prepare(
          `INSERT INTO users
          (id, username, password_hash, role, totp_secret_encrypted,
           totp_pending_secret_encrypted, totp_enabled,
           subscription_status, subscription_expires_at, subscription_plan, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.username,
          data.passwordHash,
          role,
          data.totpSecretEncrypted ?? null,
          data.totpPendingSecretEncrypted ?? null,
          data.totpEnabled ? 1 : 0,
          subscriptionStatus,
          subscriptionExpiresAt,
          data.subscriptionPlan ?? null,
          timestamp,
          timestamp,
        );
    } catch (error) {
      throw new PersistenceError('Failed to create user', error);
    }

    return this.getUserById(id);
  }

  async getUserById(id) {
    this._ensureDb();
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  }

  async getUserByUsername(username) {
    this._ensureDb();
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null;
  }

  async updateUser(id, data) {
    this._ensureDb();
    const existing = await this.getUserById(id);
    if (!existing) {
      return null;
    }

    try {
      this.db
        .prepare(
          `UPDATE users SET
            password_hash = ?,
            role = ?,
            totp_secret_encrypted = ?,
            totp_pending_secret_encrypted = ?,
            totp_enabled = ?,
            subscription_status = ?,
            subscription_expires_at = ?,
            subscription_plan = ?,
            updated_at = ?
          WHERE id = ?`,
        )
        .run(
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
        );
    } catch (error) {
      throw new PersistenceError('Failed to update user', error);
    }

    return this.getUserById(id);
  }

  async listUsers() {
    this._ensureDb();
    return this.db.prepare('SELECT * FROM users ORDER BY username ASC').all();
  }

  async countUsers() {
    this._ensureDb();
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get();
    return row?.count ?? 0;
  }

  async insertRefreshToken(data) {
    this._ensureDb();
    try {
      this.db
        .prepare(
          `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, revoked_at, created_at)
          VALUES (?, ?, ?, NULL, ?)`,
        )
        .run(data.tokenHash, data.userId, data.expiresAt, nowIso());
    } catch (error) {
      throw new PersistenceError('Failed to store refresh token', error);
    }
  }

  async getRefreshToken(tokenHash) {
    this._ensureDb();
    return this.db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) ?? null;
  }

  async revokeRefreshToken(tokenHash) {
    this._ensureDb();
    const result = this.db
      .prepare(
        'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      )
      .run(nowIso(), tokenHash);
    return result.changes > 0;
  }
}

module.exports = {
  SqlitePersistenceAdapter,
};
