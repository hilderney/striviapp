'use strict';

const path = require('path');

/**
 * Resolve absolute writable paths for desktop mode (FASE 7 §6).
 * @param {{ userData: string, documents: string }} paths
 */
function resolveDesktopPaths({ userData, documents }) {
  const appData = path.join(userData, 'app-data');
  return {
    appData,
    dbPath: path.join(appData, 'app.db'),
    secretsPath: path.join(appData, 'secrets.bin'),
    licenseStatePath: path.join(appData, 'license-state.bin'),
    logsDir: path.join(userData, 'logs'),
    stagingDir: path.join(userData, 'staging'),
    inputDir: path.join(userData, 'input'),
    outputDir: path.join(documents, 'Striviapp'),
  };
}

module.exports = {
  resolveDesktopPaths,
};
