const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado à aba interna de histórico — só ela recebe este preload,
// nunca uma aba com conteúdo web arbitrário, então a API fica restrita
// ao necessário (ler histórico, navegar).
contextBridge.exposeInMainWorld('historyAPI', {
  getHistory: (range) => ipcRenderer.invoke('history:get', range),
  openUrl: (url) => ipcRenderer.invoke('nav:go', url),
  deleteEntry: (id) => ipcRenderer.invoke('history:delete', id),
  clearAll: () => ipcRenderer.invoke('history:clear'),
});

// Cabeçalho que arrasta e bordas que redimensionam o painel (ver panel-frame.js).
contextBridge.exposeInMainWorld("panelAPI", {
  close: () => ipcRenderer.invoke("panel:close", "history"),
  startDrag: () => ipcRenderer.invoke("panel:dragStart", "history"),
  endDrag: () => ipcRenderer.invoke("panel:dragEnd"),
  startResize: (edge) => ipcRenderer.invoke("panel:resizeStart", "history", edge),
});
