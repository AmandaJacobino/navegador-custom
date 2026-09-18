const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado à janela de impressão (Ctrl+P). CUPS aqui não tem
// nenhum destino cadastrado, então a única opção real é gerar PDF.
contextBridge.exposeInMainWorld('printAPI', {
  getDefaultPath: () => ipcRenderer.invoke('print:get-default-path'),
  browse: (currentPath) => ipcRenderer.invoke('print:browse', currentPath),
  print: (outputPath) => ipcRenderer.invoke('print:submit', outputPath),
  cancel: () => ipcRenderer.invoke('print:cancel'),
});
