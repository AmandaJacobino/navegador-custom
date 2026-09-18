const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado à janela independente de downloads — nunca é usado
// numa aba com conteúdo web arbitrário, então a API fica restrita
// ao necessário (listar e abrir o local do download).
contextBridge.exposeInMainWorld('downloadsAPI', {
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  openInFolder: (path) => ipcRenderer.invoke('downloads:showInFolder', path),
  onUpdate: (callback) =>
    ipcRenderer.on('downloads:update', (_e, items) => callback(items)),
});
