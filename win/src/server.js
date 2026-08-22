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

/**
 * Desktop / start:web de debug: sempre SQLite local.
 * Nenhuma configuração PERSISTENCE=mysql pode ser herdada pelo win/.
 */
function resolvePersistenceConfig() {
  const type = (process.env.PERSISTENCE || 'sqlite').toLowerCase();
  if (type === 'mysql') {
    throw new Error(
      'PERSISTENCE=mysql não é suportado em win/. Use PERSISTENCE=sqlite (ou omita). ' +
        'MySQL permanece disponível somente em web/ e no license-server.',
    );
  }
  return {
    type: 'sqlite',
    options: { dbPath: resolveProductPath(process.env.DB_PATH, path.join('data', 'app.db')) },
  };
}

function createWebApp() {
  // TEMP (versão de testes): desliga validação TOTP / elevação também no start:web.
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

  console.log(`Striviapp — win (start:web debug)`);
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
    if (error.cause) {
      console.error(error.cause.message);
    }
    process.exit(1);
  });
}
