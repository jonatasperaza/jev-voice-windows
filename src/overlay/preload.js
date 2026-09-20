'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jevVoice', {
  onStatus: (callback) => {
    ipcRenderer.on('status', (_event, payload) => callback(payload));
  },
});
