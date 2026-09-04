const { contextBridge, ipcRenderer } = require('electron');

// Expõe só as funções necessárias para a interface, nada mais.
// Isso mantém a UI isolada do sistema (mais seguro).
contextBridge.exposeInMainWorld('browserAPI', {
  newTab: () => ipcRenderer.invoke('tabs:new'),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  activateTab: (id) => ipcRenderer.invoke('tabs:activate', id),
  go: (urlOrQuery) => ipcRenderer.invoke('nav:go', urlOrQuery),
  back: () => ipcRenderer.invoke('nav:back'),
  forward: () => ipcRenderer.invoke('nav:forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  onTabsUpdate: (callback) =>
    ipcRenderer.on('tabs:update', (_e, data) => callback(data)),
});
