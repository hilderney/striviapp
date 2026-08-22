const path = require('path');
const { loadEnv } = require('./loadEnv');
const { LlmSummarizerBuilder } = require('./pipeline/LlmSummarizerBuilder');

loadEnv();
const phase1Api = require('./api');

const PRODUCT_ROOT = path.join(__dirname, '..');

function resolveProductPath(envValue, relativeDefault) {
  const raw = envValue || relativeDefault;
  return path.isAbsolute(raw) ? raw : path.join(PRODUCT_ROOT, raw);
}

function resolvePersistenceConfig() {
  const type = (process.env.PERSISTENCE || 'sqlite').toLowerCase();
  if (type === 'mysql') {
    return {
      type: 'mysql',
      options: {
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'striviapp',
      },
    };
  }
  return {
    type: 'sqlite',
    options: { dbPath: resolveProductPath(process.env.DB_PATH, path.join('data', 'app.db')) },
  };
}

function createWebApp() {
  // TEMP (versão de testes): desliga validação TOTP / elevação.
  process.env.DISABLE_TOTP = '1';

  const persistence = resolvePersistenceConfig();
  const app = LlmSummarizerBuilder.create()
    .fromPhase1Api(phase1Api)
    .outputTo(resolveProductPath(process.env.OUTPUT_DIR, 'output'))
    .withLogs(resolveProductPath(process.env.LOGS_DIR, 'logs'))
    .withPersistence(persistence.type, persistence.options)
    .withTokenEncryption({ keyEnv: 'APP_SECRET_KEY' })
    .registerLlmProviders(['ollama', 'openrouter'])
    .serve({
      port: Number(process.env.PORT || 4000),
      host: process.env.HOST || '127.0.0.1',
      staticDir: path.join(PRODUCT_ROOT, 'public'),
    })
    .build();

  return { app, persistence };
}

async function main() {
  const { app, persistence } = createWebApp();

  await app.start();

  console.log(`Striviapp — Fase 6`);
  console.log(`UI: ${app.url}`);
  console.log(`Persistence: ${persistence.type}`);
  console.log(`API: ${app.url}/api/v1/files`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  resolvePersistenceConfig,
  createWebApp,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
