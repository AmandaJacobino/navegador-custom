const { contextBridge, ipcRenderer } = require('electron');

// Expõe só as funções necessárias para a interface, nada mais.
// Isso mantém a UI isolada do sistema (mais seguro).
contextBridge.exposeInMainWorld('browserAPI', {
  newTab: () => ipcRenderer.invoke('tabs:new'),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  activateTab: (id) => ipcRenderer.invoke('tabs:activate', id),
  toggleMute: (id) => ipcRenderer.invoke('tabs:toggleMute', id),
  go: (urlOrQuery) => ipcRenderer.invoke('nav:go', urlOrQuery),
  back: () => ipcRenderer.invoke('nav:back'),
  forward: () => ipcRenderer.invoke('nav:forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  onTabsUpdate: (callback) =>
    ipcRenderer.on('tabs:update', (_e, data) => callback(data)),
  onFocusAddress: (callback) => ipcRenderer.on('ui:focus-address', () => callback()),
  onToggleFindbar: (callback) => ipcRenderer.on('ui:toggle-findbar', () => callback()),
  setOverlayHeight: (px) => ipcRenderer.invoke('ui:set-overlay-height', px),
  findStart: (text) => ipcRenderer.invoke('find:start', text),
  findNext: (text) => ipcRenderer.invoke('find:next', text),
  findPrev: (text) => ipcRenderer.invoke('find:prev', text),
  findStop: () => ipcRenderer.invoke('find:stop'),
});
