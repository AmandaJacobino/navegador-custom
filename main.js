const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell } = require('electron');
const path = require('path');

const HISTORY_PRELOAD = path.join(__dirname, 'history-preload.js');
const DOWNLOADS_PRELOAD = path.join(__dirname, 'downloads-preload.js');

// Altura da barra de UI (abas + endereço) em pixels.
// As páginas web (BrowserView) começam abaixo dessa altura.
const UI_HEIGHT = 84;

let mainWindow;
let historyWindow = null;   // janela independente de histórico (Ctrl+H)
let downloadsWindow = null; // janela independente de downloads (Ctrl+D)
let tabs = [];      // cada item: { id, view, title, url }
let activeTabId = null;
let previousTabId = null; // última aba ativa antes da atual, para Ctrl+Tab
let nextTabId = 1;
let history = [];   // { id, url, title, timestamp }
let nextHistoryId = 1;
let downloads = []; // { filename, path, url, state, startedAt }
// Espaço extra reservado no topo quando um painel (busca/downloads) está
// aberto. O BrowserView fica acima do DOM da janela, então "abrir" um
// painel HTML não basta: é preciso empurrar o BrowserView pra baixo.
let overlayReserved = 0;

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

function sendDownloadsUpdate() {
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    downloadsWindow.webContents.send('downloads:update', downloads);
  }
}

// Fecha a própria janela com Ctrl+W, igual ao comportamento de fechar aba
// na janela principal.
function closeOnCtrlW(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      win.close();
    }
  });
}

// Janela independente de histórico (issue #6, Ctrl+H).
function openHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }
  historyWindow = new BrowserWindow({
    width: 480,
    height: 600,
    title: 'Histórico',
    webPreferences: {
      preload: HISTORY_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  historyWindow.setMenuBarVisibility(false);
  historyWindow.loadFile('history.html');
  closeOnCtrlW(historyWindow);
  historyWindow.on('closed', () => { historyWindow = null; });
}

// Janela independente de downloads (issue #6, Ctrl+D). Separada da janela
// principal porque downloads não fazem parte da navegação por abas.
function openDownloadsWindow() {
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    downloadsWindow.focus();
    return;
  }
  downloadsWindow = new BrowserWindow({
    width: 480,
    height: 600,
    title: 'Downloads',
    webPreferences: {
      preload: DOWNLOADS_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  downloadsWindow.setMenuBarVisibility(false);
  downloadsWindow.loadFile('downloads.html');
  closeOnCtrlW(downloadsWindow);
  downloadsWindow.on('closed', () => { downloadsWindow = null; });
}

function layoutActiveView() {
  const tab = getActiveTab();
  if (!tab) return;
  const bounds = mainWindow.getContentBounds();
  const top = UI_HEIGHT + overlayReserved;
  tab.view.setBounds({
    x: 0,
    y: top,
    width: bounds.width,
    height: Math.max(bounds.height - top, 0),
  });
}

function switchTab(direction) {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx === -1 || tabs.length < 2) return;
  const next = (idx + direction + tabs.length) % tabs.length;
  activateTab(tabs[next].id);
}

function sendTabsUpdate() {
  const tab = getActiveTab();
  mainWindow.webContents.send('tabs:update', {
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      muted: t.muted,
      audible: t.view.webContents.isCurrentlyAudible(),
    })),
    activeTabId,
    canGoBack: tab ? tab.view.webContents.canGoBack() : false,
    canGoForward: tab ? tab.view.webContents.canGoForward() : false,
  });
}

function createTab(url = 'https://duckduckgo.com') {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  const tab = { id, view, title: 'Nova aba', url, muted: false };
  tabs.push(tab);

  view.webContents.on('page-title-updated', (_e, title) => {
    tab.title = title;
    sendTabsUpdate();
  });
  view.webContents.on('did-navigate', (_e, navUrl) => {
    tab.url = navUrl;
    history.unshift({ id: nextHistoryId++, url: navUrl, title: tab.title, timestamp: Date.now() });
    sendTabsUpdate();
  });
  view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
    tab.url = navUrl;
    sendTabsUpdate();
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });
  view.webContents.on('audio-state-changed', () => {
    sendTabsUpdate();
  });
  view.webContents.session.on('will-download', (_e, item) => {
    const entry = {
      filename: item.getFilename(),
      path: item.getSavePath() || item.getFilename(),
      url: item.getURL(),
      state: 'progressing',
      startedAt: Date.now(),
    };
    downloads.unshift(entry);
    sendDownloadsUpdate();
    item.once('done', (_e2, state) => {
      entry.state = state;
      entry.path = item.getSavePath() || entry.path;
      sendDownloadsUpdate();
    });
  });

  view.webContents.loadURL(url);
  activateTab(id);
  return id;
}

function goToLastTab() {
  if (previousTabId == null) return;
  const tab = tabs.find((t) => t.id === previousTabId);
  if (!tab) { previousTabId = null; return; }
  activateTab(tab.id);
}

function activateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (activeTabId != null && activeTabId !== id) {
    previousTabId = activeTabId;
  }
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  layoutActiveView();
  // Trocar o BrowserView não move o foco de teclado sozinho — sem isso, os
  // atalhos só voltam a funcionar depois de um clique manual na aba.
  tab.view.webContents.focus();
  sendTabsUpdate();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const [tab] = tabs.splice(idx, 1);
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();

  if (activeTabId === id) {
    const next = tabs[idx] || tabs[idx - 1];
    if (next) {
      activateTab(next.id);
    } else {
      activeTabId = null;
      createTab(); // sempre mantém pelo menos uma aba aberta
    }
  }
  sendTabsUpdate();
}

function filterHistory(range) {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (range === 'yesterday') {
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    return history.filter((h) => h.timestamp >= startOfYesterday && h.timestamp < startOfToday);
  }
  const rangeStarts = {
    today: startOfToday,
    '7days': now - 7 * 24 * 60 * 60 * 1000,
    '30days': now - 30 * 24 * 60 * 60 * 1000,
    all: 0,
  };
  const since = rangeStarts[range] ?? startOfToday;
  return history.filter((h) => h.timestamp >= since);
}

// Atalhos de teclado (issue #6). Registrado tanto no webContents da janela
// principal quanto no de cada BrowserView, já que o BrowserView tem seu
// próprio webContents e não recebe eventos de teclado da janela.
function handleShortcut(input) {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  const ctrl = input.control;
  const shift = input.shift;
  const tab = getActiveTab();

  if (ctrl && key === 't') { createTab(); return true; }
  if (ctrl && key === 'w') { if (activeTabId != null) closeTab(activeTabId); return true; }
  if (ctrl && key === 'tab') { if (shift) switchTab(-1); else goToLastTab(); return true; }
  if (ctrl && key === 'l') {
    // Sem isso, o BrowserView da aba continua com o foco de teclado do SO
    // e a digitação não chega no input, mesmo após o focus() no DOM.
    mainWindow.webContents.focus();
    mainWindow.webContents.send('ui:focus-address');
    return true;
  }
  if ((ctrl && key === 'r') || key === 'f5') { if (tab) tab.view.webContents.reload(); return true; }
  if (ctrl && key === 'h') { openHistoryWindow(); return true; }
  if (ctrl && key === 'd') { openDownloadsWindow(); return true; }
  if (ctrl && key === 'f') { mainWindow.webContents.send('ui:toggle-findbar'); return true; }
  if (ctrl && key === 's') {
    if (tab) {
      const safeName = (tab.title || 'pagina').replace(/[\\/:*?"<>|]/g, '_');
      const dest = path.join(app.getPath('downloads'), `${safeName}.html`);
      tab.view.webContents
        .savePage(dest, 'HTMLComplete')
        .then(() => {
          downloads.unshift({ filename: `${safeName}.html`, path: dest, url: tab.url, state: 'completed', startedAt: Date.now() });
          sendDownloadsUpdate();
        })
        .catch(() => {});
    }
    return true;
  }
  if (ctrl && key === 'p') { if (tab) tab.view.webContents.print(); return true; }
  if (ctrl && key === 'm') {
    if (tab) {
      tab.muted = !tab.muted;
      tab.view.webContents.setAudioMuted(tab.muted);
      sendTabsUpdate();
    }
    return true;
  }
  return false;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('resize', layoutActiveView);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    createTab();
  });
}

// --- Comunicação com a interface (renderer.js) ---

ipcMain.handle('tabs:new', () => createTab());
ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
ipcMain.handle('tabs:activate', (_e, id) => activateTab(id));
ipcMain.handle('tabs:toggleMute', (_e, id) => {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.muted = !tab.muted;
  tab.view.webContents.setAudioMuted(tab.muted);
  sendTabsUpdate();
});

ipcMain.handle('nav:go', (_e, urlOrQuery) => {
  const tab = getActiveTab();
  if (!tab) return;
  let target = urlOrQuery.trim();
  const looksLikeUrl = /^https?:\/\//i.test(target) || /^[\w-]+\.[a-z]{2,}/i.test(target);
  if (!looksLikeUrl) {
    target = 'https://duckduckgo.com/?q=' + encodeURIComponent(target);
  } else if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }
  tab.view.webContents.loadURL(target);
});

ipcMain.handle('nav:back', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});

ipcMain.handle('nav:forward', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});

ipcMain.handle('nav:reload', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.reload();
});

ipcMain.handle('history:get', (_e, range) => filterHistory(range));
ipcMain.handle('history:delete', (_e, id) => {
  history = history.filter((h) => h.id !== id);
});
ipcMain.handle('history:clear', () => {
  history = [];
});
ipcMain.handle('downloads:get', () => downloads);
ipcMain.handle('downloads:showInFolder', (_e, filePath) => shell.showItemInFolder(filePath));

ipcMain.handle('ui:set-overlay-height', (_e, px) => {
  overlayReserved = typeof px === 'number' && px > 0 ? px : 0;
  layoutActiveView();
});

ipcMain.handle('find:start', (_e, text) => {
  const tab = getActiveTab();
  if (tab && text) tab.view.webContents.findInPage(text);
});
ipcMain.handle('find:next', (_e, text) => {
  const tab = getActiveTab();
  if (tab && text) tab.view.webContents.findInPage(text, { forward: true, findNext: true });
});
ipcMain.handle('find:prev', (_e, text) => {
  const tab = getActiveTab();
  if (tab && text) tab.view.webContents.findInPage(text, { forward: false, findNext: true });
});
ipcMain.handle('find:stop', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
});

app.whenReady().then(() => {
  // Sem isso, o menu padrão do Electron reserva Ctrl+R para recarregar a
  // janela principal (index.html) e colidiria com o Ctrl+R de recarregar a aba.
  Menu.setApplicationMenu(null);
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
