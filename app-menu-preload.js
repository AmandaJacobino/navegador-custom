const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appMenuAPI', {
  onShow: (callback) => ipcRenderer.on('app-menu:show', () => callback()),
  openMemory: () => ipcRenderer.invoke('appMenu:openMemory'),
  close: () => ipcRenderer.invoke('appMenu:close'),
});
