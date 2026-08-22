const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../modules/logger');
const { createAppServer } = require('../modules/appServer');
const { createPersistenceAdapter } = require('../adapters/persistenceAdapter');
const { createCryptoAdapter } = require('../adapters/cryptoAdapter');
const { createLlmModelService } = require('../modules/llmModelService');
const { createLlmProcessService } = require('../modules/llmProcessService');
const { createAuthService } = require('../modules/authService');

class LlmSummarizerBuilder {
  constructor() {
    this._phase1Api = null;
    this._outputDir = './output';
    this._logsDir = './logs';
    this._dbPath = process.env.DB_PATH || './data/app.db';
    this._persistenceType = 'sqlite';
    this._persistenceOptions = {};
    this._keyEnv = 'APP_SECRET_KEY';
    this._secret = null;
    this._llmProviders = ['ollama', 'openrouter'];
    this._serve = true;
    this._port = 4000;
    this._host = '127.0.0.1';
    this._staticDir = './public';
    this._auth = {
      enabled: true,
      jwtSecretEnv: 'JWT_SECRET',
      accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS || 900),
      refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS || 7 * 24 * 60 * 60),
      elevationTtlSeconds: Number(process.env.ELEVATION_TTL_SECONDS || 900),
      bootstrapAdminUser: process.env.BOOTSTRAP_ADMIN_USER || 'admin',
      bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123',
    };
  }

  static create() {
    return new LlmSummarizerBuilder();
  }

  fromPhase1Api(api) {
    this._phase1Api = api;
    return this;
  }

  outputTo(outputDir) {
    this._outputDir = outputDir;
    return this;
  }

  withLogs(logsDir) {
    this._logsDir = logsDir;
    return this;
  }

  withPersistence(type, options = {}) {
    this._persistenceType = type;
    this._persistenceOptions = options;
    if (options.dbPath) {
      this._dbPath = options.dbPath;
    }
    return this;
  }

  withTokenEncryption(options = {}) {
    if (options.keyEnv) {
      this._keyEnv = options.keyEnv;
    }
    if (options.secret) {
      this._secret = options.secret;
    }
    return this;
  }

  registerLlmProviders(types) {
    const allowed = new Set(['ollama', 'openrouter']);
    for (const type of types) {
      if (!allowed.has(type)) {
        throw new Error(`Unknown LLM provider: ${type}`);
      }
    }
    this._llmProviders = [...types];
    return this;
  }

  withAuth(options = {}) {
    this._auth = { ...this._auth, ...options, enabled: true };
    return this;
  }

  withoutAuth() {
    this._auth = { ...this._auth, enabled: false };
    return this;
  }

  serve({ port = 4000, host = '127.0.0.1', staticDir = './public' } = {}) {
    this._serve = true;
    this._port = port;
    this._host = host;
    this._staticDir = staticDir;
    return this;
  }

  withoutServer() {
    this._serve = false;
    return this;
  }

  build() {
    return new LlmSummarizerApp(this);
  }

  getConfig() {
    return {
      phase1Api: this._phase1Api,
      outputDir: path.resolve(this._outputDir),
      logsDir: path.resolve(this._logsDir),
      dbPath: path.resolve(this._dbPath),
      persistenceType: this._persistenceType,
      persistenceOptions: { ...this._persistenceOptions, dbPath: this._dbPath },
      keyEnv: this._keyEnv,
      secret: this._secret,
      llmProviders: [...this._llmProviders],
      serve: this._serve,
      port: this._port,
      host: this._host,
      staticDir: path.resolve(this._staticDir),
      auth: { ...this._auth },
    };
  }
}

class LlmSummarizerApp {
  constructor(builder) {
    this.config = builder.getConfig();
    this.logger = null;
    this.server = null;
    this.persistence = null;
    this.llmModelService = null;
    this.llmProcessService = null;
    this.authService = null;
  }

  async start() {
    const config = this.config;

    if (!config.phase1Api) {
      throw new Error('Phase 1 API is required. Use fromPhase1Api().');
    }

    this.logger = createLogger('llm-app', { logsDir: config.logsDir });
    this.logger.info('Starting LLM summarizer app', {
      outputDir: config.outputDir,
      persistenceType: config.persistenceType,
      serve: config.serve,
    });

    this.persistence = createPersistenceAdapter(config.persistenceType, config.persistenceOptions);
    await this.persistence.init(config.persistenceOptions);

    const cryptoOptions = config.secret
      ? { secret: config.secret, keyEnv: config.keyEnv }
      : { keyEnv: config.keyEnv };

    if (!config.secret && !process.env[config.keyEnv]) {
      process.env[config.keyEnv] = crypto.randomBytes(32).toString('hex');
      const warning =
        `${config.keyEnv} não definida — chave efêmera gerada. ` +
        'Tokens salvos não sobrevivem a reinícios. Defina APP_SECRET_KEY no .env (veja .env.example).';
      this.logger.warn(warning);
      console.warn(`[striviapp] ${warning}`);
    }

    const cryptoAdapter = createCryptoAdapter(cryptoOptions);

    this.authService = null;
    if (config.auth.enabled) {
      if (!process.env[config.auth.jwtSecretEnv]) {
        process.env[config.auth.jwtSecretEnv] = crypto.randomBytes(32).toString('hex');
        const warning =
          `${config.auth.jwtSecretEnv} não definida — chave efêmera gerada. ` +
          'Sessões não sobrevivem a reinícios. Defina JWT_SECRET no .env (veja .env.example).';
        this.logger.warn(warning);
        console.warn(`[striviapp] ${warning}`);
      }

      this.authService = createAuthService({
        persistence: this.persistence,
        cryptoAdapter,
        jwtSecret: process.env[config.auth.jwtSecretEnv],
        accessTtlSeconds: config.auth.accessTtlSeconds,
        refreshTtlSeconds: config.auth.refreshTtlSeconds,
        elevationTtlSeconds: config.auth.elevationTtlSeconds,
      });

      const seeded = await this.authService.seedAdminIfEmpty({
        username: config.auth.bootstrapAdminUser,
        password: config.auth.bootstrapAdminPassword,
      });
      if (seeded && !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
        const warning =
          `Usuário ADM inicial "${seeded.username}" criado com a senha padrão. ` +
          'Defina BOOTSTRAP_ADMIN_PASSWORD no .env e troque a senha imediatamente.';
        this.logger.warn(warning);
        console.warn(`[striviapp] ${warning}`);
      }

      // TEMP (versão de testes): usuários fixos para QA. Remover antes do release.
      const testUsers = [
        { username: 'Heron', password: 'Heron123', role: 'ADM' },
        { username: 'Roger', password: 'Roger123', role: 'ADM' },
      ];
      for (const user of testUsers) {
        const created = await this.authService.ensureUserIfMissing(user);
        if (created) {
          this.logger.info(`Usuário de teste criado: ${created.username}`);
        }
      }
    }

    this.llmModelService = createLlmModelService({
      persistence: this.persistence,
      cryptoAdapter,
    });

    this.llmProcessService = createLlmProcessService({
      persistence: this.persistence,
      modelService: this.llmModelService,
      outputDir: config.outputDir,
      // Com porta efêmera a URL real só existe após listen(); resolvida a cada uso.
      baseUrl: () => this.server?.url || `http://${config.host}:${config.port}`,
      logger: this.logger,
    });

    if (config.serve) {
      this.server = await createAppServer({
        port: config.port,
        host: config.host,
        outputDir: config.outputDir,
        staticDir: config.staticDir,
        logsDir: config.logsDir,
        phase1Api: config.phase1Api,
        llmModelService: this.llmModelService,
        llmProcessService: this.llmProcessService,
        authService: this.authService,
      });

      this.logger.info('App server started', { url: this.server.url });
    }

    return this;
  }

  get url() {
    return this.server?.url || null;
  }

  async close() {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }

    if (this.persistence) {
      await this.persistence.close();
      this.persistence = null;
    }

    if (this.logger) {
      await this.logger.close();
      this.logger = null;
    }
  }
}

module.exports = {
  LlmSummarizerBuilder,
  LlmSummarizerApp,
};
