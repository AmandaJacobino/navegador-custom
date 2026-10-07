const { contextBridge, ipcRenderer } = require('electron');

// Preload dedicado ao painel interno de memória: lê as métricas e fecha abas.
contextBridge.exposeInMainWorld('memoryAPI', {
  getUsage: () => ipcRenderer.invoke('memory:get'),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  onVisibility: (callback) => ipcRenderer.on('panel:visibility', (_e, visible) => callback(visible)),
});

// Cabeçalho que arrasta e bordas que redimensionam o painel (ver panel-frame.js).
contextBridge.exposeInMainWorld('panelAPI', {
  close: () => ipcRenderer.invoke('panel:close', 'memory'),
  startDrag: () => ipcRenderer.invoke('panel:dragStart', 'memory'),
  endDrag: () => ipcRenderer.invoke('panel:dragEnd'),
  startResize: (edge) => ipcRenderer.invoke('panel:resizeStart', 'memory', edge),
});
