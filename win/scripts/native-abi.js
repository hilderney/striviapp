'use strict';

/**
 * better-sqlite3 é nativo: um único node_modules não serve Node e Electron ao
 * mesmo tempo (NODE_MODULE_VERSION diferente). Este script garante que o
 * binário compilado corresponda ao runtime que está a ser usado, recompilando
 * apenas quando necessário.
 *
 * Uso: node scripts/native-abi.js <node|electron>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TARGETS = new Set(['node', 'electron']);
const ROOT = path.join(__dirname, '..');
const MARKER_PATH = path.join(ROOT, 'node_modules', '.better-sqlite3-abi');
const FORGE_META_PATH = path.join(
  ROOT,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  '.forge-meta',
);

function readMarker() {
  try {
    return fs.readFileSync(MARKER_PATH, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeMarker(target) {
  fs.writeFileSync(MARKER_PATH, `${target}\n`);
}

// O require de better-sqlite3 é lazy: o binário nativo só é carregado ao
// instanciar um Database, então o probe precisa abrir um banco em memória.
function loadsUnderNode() {
  const probe = spawnSync(
    process.execPath,
    ['-e', "new (require('better-sqlite3'))(':memory:').close()"],
    { cwd: ROOT, stdio: 'ignore' },
  );
  return probe.status === 0;
}

function rebuild(target) {
  const command =
    target === 'electron' ? 'electron-builder install-app-deps' : 'npm rebuild better-sqlite3';

  // @electron/rebuild usa .forge-meta para pular rebuilds da mesma versão do
  // Electron; sem apagá-lo, um binário trocado por npm rebuild nunca é refeito.
  fs.rmSync(FORGE_META_PATH, { force: true });

  console.log(`[native-abi] rebuilding better-sqlite3 for ${target}...`);
  // Comando inteiro como string: os binários do npm no Windows são .cmd e
  // exigem shell, e passar args separados com shell:true dispara DEP0190.
  const result = spawnSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`[native-abi] rebuild for ${target} failed`);
    process.exit(result.status ?? 1);
  }
  writeMarker(target);
}

function main() {
  const target = process.argv[2];
  if (!TARGETS.has(target)) {
    console.error('Usage: node scripts/native-abi.js <node|electron>');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'better-sqlite3'))) {
    console.error('[native-abi] better-sqlite3 not installed; run npm install first');
    process.exit(1);
  }

  // No target Node o próprio require é a verificação autoritativa; no Electron
  // não é possível carregar o módulo daqui, então confia-se no marcador.
  if (target === 'node' && loadsUnderNode()) {
    writeMarker('node');
    return;
  }
  if (target === 'electron' && readMarker() === 'electron') {
    return;
  }

  rebuild(target);
}

main();
