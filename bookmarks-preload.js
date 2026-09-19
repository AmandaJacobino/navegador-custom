const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado à janela de favoritos — só ela recebe este preload,
// nunca uma aba com conteúdo web arbitrário, então a API fica restrita
// ao necessário (ler favoritos, abrir, remover).
contextBridge.exposeInMainWorld('bookmarksAPI', {
  getAll: () => ipcRenderer.invoke('bookmarks:get'),
  openUrl: (url) => ipcRenderer.invoke('nav:go', url),
  remove: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  onUpdate: (callback) => ipcRenderer.on('bookmarks:update', (_e, data) => callback(data)),
});
