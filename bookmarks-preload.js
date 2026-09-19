const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado à janela de favoritos — só ela recebe este preload,
// nunca uma aba com conteúdo web arbitrário, então a API fica restrita
// ao necessário (ler/organizar favoritos, abrir URLs).
contextBridge.exposeInMainWorld('bookmarksAPI', {
  getAll: () => ipcRenderer.invoke('bookmarks:get'),
  openUrl: (url) => ipcRenderer.invoke('nav:go', url),
  remove: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  rename: (id, title) => ipcRenderer.invoke('bookmarks:rename', id, title),
  move: (id, parentId) => ipcRenderer.invoke('bookmarks:move', id, parentId),
  addFolder: (title, parentId) => ipcRenderer.invoke('bookmarks:addFolder', title, parentId),
  toggleSpeedDial: (id) => ipcRenderer.invoke('bookmarks:toggleSpeedDial', id),
  onUpdate: (callback) => ipcRenderer.on('bookmarks:update', (_e, data) => callback(data)),
});
