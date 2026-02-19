const { contextBridge, ipcRenderer } = require('electron');

const api = {
  releaseNotesUrl: 'https://github.com/mainulhossain/keynotter/releases',
  getBootstrap: () => ipcRenderer.invoke('bootstrap:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  setScriptText: (payload) => ipcRenderer.invoke('script:set-text', payload),
  updateCursor: (payload) => ipcRenderer.invoke('script:cursor-update', payload),
  openScriptFile: () => ipcRenderer.invoke('script:file-open'),
  saveScriptFile: (payload) => ipcRenderer.invoke('script:file-save', payload),
  sendPromptCommand: (payload) => ipcRenderer.invoke('prompt:command', payload),
  resizeOverlay: (payload) => ipcRenderer.invoke('overlay:resize', payload),
  moveOverlay: (payload) => ipcRenderer.invoke('overlay:move', payload),
  onHotkeyEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('hotkey:event', wrapped);
    return () => ipcRenderer.removeListener('hotkey:event', wrapped);
  },
  onStateChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('state:changed', wrapped);
    return () => ipcRenderer.removeListener('state:changed', wrapped);
  }
};

contextBridge.exposeInMainWorld('teleprompter', api);
