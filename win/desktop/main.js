'use strict';

const path = require('path');
const { app, BrowserWindow, shell, dialog, safeStorage } = require('electron');

const { loadEnv } = require('../src/loadEnv');
const { resolveDesktopPaths } = require('./desktopConfig');
const { createDesktopSecretStore } = require('./desktopSecretStore');

loadEnv();

let mainWindow = null;
let desktopApp = null;
let shuttingDown = false;

function isSameOrigin(target, appOrigin) {
  try {
    return new URL(target).origin === appOrigin;
  } catch {
    return false;
  }
}

function createMainWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#111827',
    title: 'Striviapp',
    icon: path.join(__dirname, '..', 'assets', 'ico', 'Strviaap_256.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.removeMenu();
  window.once('ready-to-show', () => window.show());

  // Links externos vão para o navegador do sistema, nunca para dentro do shell.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  const appOrigin = new URL(url).origin;
  window.webContents.on('will-navigate', (event, target) => {
    if (isSameOrigin(target, appOrigin)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(target);
  });

  // Uma navegação que falha (download recusado, backend fora) deixaria a janela
  // em branco: recarrega a SPA em vez de perder a interface.
  window.webContents.on('did-fail-load', (event, errorCode, errorDescription, failingUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    console.error(`[desktop] load failed (${errorDescription}): ${failingUrl}`);
    window.loadURL(url);
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  window.loadURL(url);
  return window;
}

async function startBackend() {
  const paths = resolveDesktopPaths({
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
  });

  const secretStore = createDesktopSecretStore({
    filePath: paths.secretsPath,
    safeStorage,
  });
  const secrets = secretStore.loadOrCreate();

  const { createDesktopApp } = require('../src/desktop/createDesktopApp');
  const phase1Api = require('../src/api');

  const instance = createDesktopApp({
    paths,
    phase1Api,
    appSecretKey: secrets.appSecretKey,
    jwtSecret: secrets.jwtSecret,
  });

  await instance.start();
  return instance;
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    if (desktopApp) {
      await desktopApp.close();
      desktopApp = null;
    }
  } catch (error) {
    console.error('[desktop] shutdown failed:', error.message);
  }
}

function reportFatal(error) {
  const detail =
    error.code === 'SECURE_STORAGE_UNAVAILABLE'
      ? 'O armazenamento seguro do Windows (DPAPI) não está disponível para este usuário.'
      : `${error.message}${error.cause ? `\n\n${error.cause.message}` : ''}`;

  console.error('[desktop] startup failed:', detail);
  dialog.showErrorBox('Striviapp', `Falha ao iniciar o aplicativo.\n\n${detail}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      desktopApp = await startBackend();
      console.log(`[desktop] backend ready at ${desktopApp.url}`);
      mainWindow = createMainWindow(desktopApp.url);
    } catch (error) {
      reportFatal(error);
      await shutdown();
      app.exit(1);
    }
  });

  app.on('activate', () => {
    if (!mainWindow && desktopApp) {
      mainWindow = createMainWindow(desktopApp.url);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (!desktopApp) {
      return;
    }
    // Fecha SQLite e logger antes de sair para não corromper o banco local.
    event.preventDefault();
    shutdown().then(() => app.quit());
  });
}
