'use strict';

/**
 * Orquestra o modo de desenvolvimento do monorepo: sobe o servidor web e o
 * desktop Electron em paralelo, com logs prefixados e teardown em Ctrl+C.
 *
 * Uso: node scripts/dev.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const COLORS = {
  web: '\x1b[36m', // cyan
  win: '\x1b[35m', // magenta
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function colorize(label, text) {
  if (!USE_COLOR) {
    return text;
  }
  return `${COLORS[label] || ''}${text}${COLORS.reset}`;
}

function log(message) {
  const prefix = USE_COLOR ? `${COLORS.dim}[dev]${COLORS.reset}` : '[dev]';
  console.log(`${prefix} ${message}`);
}

function ensureInstalled() {
  const missing = [];
  for (const product of ['web', 'win']) {
    if (!fs.existsSync(path.join(ROOT, product, 'node_modules'))) {
      missing.push(product);
    }
  }
  if (missing.length === 0) {
    return;
  }
  console.error(
    `[dev] missing node_modules in: ${missing.join(', ')}. Run: npm run install:all`,
  );
  process.exit(1);
}

function pipeLines(stream, label, write) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      write(`${colorize(label, `[${label}]`)} ${line}\n`);
      newline = buffer.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      write(`${colorize(label, `[${label}]`)} ${buffer.replace(/\r$/, '')}\n`);
      buffer = '';
    }
  });
}

function killTree(pid) {
  if (!pid) {
    return;
  }
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function shutdown(code = exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  exitCode = code;
  log('shutting down...');

  for (const child of children.values()) {
    killTree(child.pid);
  }

  // Give taskkill a moment, then exit regardless.
  setTimeout(() => process.exit(exitCode), IS_WIN ? 500 : 200).unref();
}

function start(label, npmArgs) {
  // Comando inteiro como string: no Windows os binários npm são .cmd e
  // exigem shell, e passar args separados com shell:true dispara DEP0190.
  const child = spawn(`npm ${npmArgs.join(' ')}`, {
    cwd: ROOT,
    shell: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.set(label, child);
  pipeLines(child.stdout, label, (line) => process.stdout.write(line));
  pipeLines(child.stderr, label, (line) => process.stderr.write(line));

  child.on('error', (error) => {
    console.error(`[dev] failed to start ${label}: ${error.message}`);
    exitCode = 1;
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    children.delete(label);
    if (shuttingDown) {
      return;
    }
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    log(`${label} exited (${reason})`);
    if (code && code !== 0) {
      exitCode = code;
    }
    shutdown(exitCode || (code && code !== 0 ? code : 0));
  });

  return child;
}

function main() {
  ensureInstalled();

  log('starting web + desktop (Ctrl+C to stop)');
  start('web', ['--prefix', 'web', 'run', 'dev']);
  start('win', ['--prefix', 'win', 'run', 'dev']);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

main();
