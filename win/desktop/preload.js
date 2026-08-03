'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('striviappDesktop', {
  getAppVersion: () => '2.0.0',
  getPlatform: () => process.platform,
});
