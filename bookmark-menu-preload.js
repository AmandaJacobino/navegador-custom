const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookmarkMenuAPI', {
  onShow: (callback) => ipcRenderer.on('bookmark-menu:show', (_e, state) => callback(state)),
  toggleBookmark: () => ipcRenderer.invoke('bookmarks:toggleCurrent'),
  toggleSpeedDial: () => ipcRenderer.invoke('bookmarks:toggleSpeedDialCurrent'),
  openManage: () => ipcRenderer.invoke('bookmarks:openManage'),
  close: () => ipcRenderer.invoke('bookmarks:closeMenu'),
});
