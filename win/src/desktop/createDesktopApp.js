'use strict';

const path = require('path');
const fs = require('fs');
const { LlmSummarizerBuilder } = require('../pipeline/LlmSummarizerBuilder');

/**
 * Monta o app local do modo desktop (FASE 7 §5).
 * Nunca chama process.exit: o ciclo de vida pertence ao Electron.
 *
 * @param {object} options
 * @param {object} options.paths saída de desktop/desktopConfig.resolveDesktopPaths
 * @param {object} options.phase1Api
 * @param {string} [options.appSecretKey]
 * @param {string} [options.jwtSecret]
 */
function createDesktopApp({ paths, phase1Api, appSecretKey, jwtSecret } = {}) {
  if (!paths) {
    throw new Error('paths is required');
  }
  if (!phase1Api) {
    throw new Error('phase1Api is required');
  }

  for (const dir of [paths.appData, paths.logsDir, paths.stagingDir, paths.inputDir, paths.outputDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (appSecretKey) {
    process.env.APP_SECRET_KEY = appSecretKey;
  }
  if (jwtSecret) {
    process.env.JWT_SECRET = jwtSecret;
  }

  // Desktop é sempre single-tenant local em SQLite; ignora PERSISTENCE do ambiente.
  process.env.APP_MODE = 'desktop';
  process.env.PERSISTENCE = 'sqlite';

  return LlmSummarizerBuilder.create()
    .fromPhase1Api(phase1Api)
    .outputTo(paths.outputDir)
    .withLogs(paths.logsDir)
    .withStaging(paths.stagingDir)
    .withInput(paths.inputDir)
    .withPersistence('sqlite', { dbPath: paths.dbPath })
    .withTokenEncryption({ keyEnv: 'APP_SECRET_KEY' })
    .registerLlmProviders(['ollama', 'openrouter'])
    .serve({
      // Porta 0 = efêmera escolhida pelo SO; evita conflito com o produto web.
      port: 0,
      host: '127.0.0.1',
      staticDir: path.join(__dirname, '..', '..', 'public'),
    })
    .build();
}

module.exports = {
  createDesktopApp,
};
