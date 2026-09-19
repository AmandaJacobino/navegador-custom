const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HISTORY_PRELOAD = path.join(__dirname, 'history-preload.js');
const DOWNLOADS_PRELOAD = path.join(__dirname, 'downloads-preload.js');
const PRINT_PRELOAD = path.join(__dirname, 'print-preload.js');
const BOOKMARKS_PRELOAD = path.join(__dirname, 'bookmarks-preload.js');
const BOOKMARKS_FILE = path.join(app.getPath('userData'), 'bookmarks.json');

// Altura da barra de UI (abas + endereço) em pixels.
// As páginas web (BrowserView) começam abaixo dessa altura.
const UI_HEIGHT = 84;

let mainWindow;
let historyWindow = null;   // janela independente de histórico (Ctrl+H)
let downloadsWindow = null; // janela independente de downloads (Ctrl+D)
let bookmarksWindow = null; // janela independente de favoritos (Ctrl+B)
let printWindow = null;     // janela independente de impressão (Ctrl+P)
let printTab = null;        // aba alvo da janela de impressão aberta
let tabs = [];      // cada item: { id, view, title, url }
let activeTabId = null;
let previousTabId = null; // última aba ativa antes da atual, para Ctrl+Tab
let nextTabId = 1;
let history = [];   // { id, url, title, timestamp }
let nextHistoryId = 1;
let downloads = []; // { filename, path, url, state, startedAt }
let bookmarks = []; // { id, url, title, createdAt }, persistido em BOOKMARKS_FILE
let nextBookmarkId = 1;
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

// Fallback do Ctrl+P quando o diálogo nativo de impressão falha (ex.: sem
// destinos CUPS cadastrados, nem "Salvar como PDF"): janela própria de
// impressão, parecida com a de outros navegadores (ex.: Falkon), mas com
// uma única opção real de destino, já que não há impressora cadastrada.
function openPrintDialog(tab) {
  printTab = tab;
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.focus();
    return;
  }
  printWindow = new BrowserWindow({
    width: 420,
    height: 320,
    title: 'Imprimir',
    resizable: false,
    webPreferences: {
      preload: PRINT_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  printWindow.setMenuBarVisibility(false);
  printWindow.loadFile('print.html');
  closeOnCtrlW(printWindow);
  printWindow.on('closed', () => { printWindow = null; printTab = null; });
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

// Janela independente de favoritos (issue #9, Ctrl+B), no mesmo estilo das
// janelas de histórico e downloads.
function openBookmarksWindow() {
  if (bookmarksWindow && !bookmarksWindow.isDestroyed()) {
    bookmarksWindow.focus();
    return;
  }
  bookmarksWindow = new BrowserWindow({
    width: 480,
    height: 600,
    title: 'Favoritos',
    webPreferences: {
      preload: BOOKMARKS_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  bookmarksWindow.setMenuBarVisibility(false);
  bookmarksWindow.loadFile('bookmarks.html');
  closeOnCtrlW(bookmarksWindow);
  bookmarksWindow.on('closed', () => { bookmarksWindow = null; });
}

function loadBookmarks() {
  try {
    const raw = fs.readFileSync(BOOKMARKS_FILE, 'utf-8');
    bookmarks = JSON.parse(raw);
    nextBookmarkId = bookmarks.reduce((max, b) => Math.max(max, b.id), 0) + 1;
  } catch {
    bookmarks = [];
  }
}

function saveBookmarks() {
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
}

function sendBookmarksUpdate() {
  if (bookmarksWindow && !bookmarksWindow.isDestroyed()) {
    bookmarksWindow.webContents.send('bookmarks:update', bookmarks);
  }
}

function isBookmarked(url) {
  return bookmarks.some((b) => b.url === url);
}

// Alterna o favorito da aba informada: remove se a URL já está salva,
// adiciona (com o título atual da aba) caso contrário.
function toggleBookmark(tab) {
  if (!tab) return;
  const existing = bookmarks.find((b) => b.url === tab.url);
  if (existing) {
    bookmarks = bookmarks.filter((b) => b.id !== existing.id);
  } else {
    bookmarks.push({ id: nextBookmarkId++, url: tab.url, title: tab.title, createdAt: Date.now() });
  }
  saveBookmarks();
  sendBookmarksUpdate();
  sendTabsUpdate();
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
      bookmarked: isBookmarked(t.url),
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
  if (ctrl && key === 'b') { openBookmarksWindow(); return true; }
  if (ctrl && key === 'f') { mainWindow.webContents.send('ui:toggle-findbar'); return true; }
  if (ctrl && key === 's') {
    if (tab) {
      const safeName = (tab.title || 'pagina').replace(/[\\/:*?"<>|]/g, '_');
      dialog
        .showSaveDialog(mainWindow, {
          defaultPath: path.join(app.getPath('downloads'), `${safeName}.html`),
          filters: [{ name: 'Página HTML', extensions: ['html'] }],
        })
        .then(({ canceled, filePath }) => {
          if (canceled || !filePath) return;
          return tab.view.webContents.savePage(filePath, 'HTMLComplete').then(() => {
            downloads.unshift({ filename: path.basename(filePath), path: filePath, url: tab.url, state: 'completed', startedAt: Date.now() });
            sendDownloadsUpdate();
            openDownloadsWindow();
          });
        })
        .catch((err) => console.error('Ctrl+S savePage failed:', err));
    }
    return true;
  }
  if (ctrl && key === 'p') {
    if (tab) {
      // O diálogo nativo do SO depende do CUPS ter destinos cadastrados
      // (nem "Salvar como PDF" aparece sem isso). Sem impressora
      // configurada ele falha em vez de abrir, então caímos pra gerar o
      // PDF direto e deixar a pessoa escolher onde salvar.
      tab.view.webContents.print({}, (success, failureReason) => {
        if (success) return;
        console.error('Ctrl+P native print failed, falling back to PDF:', failureReason);
        openPrintDialog(tab);
      });
    }
    return true;
  }
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
ipcMain.handle('tabs:reorder', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Segurança: qualquer aba fora da lista (condição de corrida improvável)
  // vai pro fim, em vez de desaparecer.
  tabs.forEach((t) => { if (!orderedIds.includes(t.id)) reordered.push(t); });
  tabs = reordered;
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

ipcMain.handle('bookmarks:get', () => bookmarks);
ipcMain.handle('bookmarks:toggleActive', () => toggleBookmark(getActiveTab()));
ipcMain.handle('bookmarks:remove', (_e, id) => {
  bookmarks = bookmarks.filter((b) => b.id !== id);
  saveBookmarks();
  sendBookmarksUpdate();
  sendTabsUpdate();
});

ipcMain.handle('print:get-default-path', () => {
  const safeName = (printTab?.title || 'pagina').replace(/[\\/:*?"<>|]/g, '_');
  return path.join(app.getPath('downloads'), `${safeName}.pdf`);
});
ipcMain.handle('print:browse', async (_e, currentPath) => {
  const { canceled, filePath } = await dialog.showSaveDialog(printWindow, {
    defaultPath: currentPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return canceled ? null : filePath;
});
ipcMain.handle('print:submit', async (_e, outputPath) => {
  const tab = printTab;
  if (!tab || !outputPath) return;
  try {
    const data = await tab.view.webContents.printToPDF({});
    fs.writeFileSync(outputPath, data);
    downloads.unshift({ filename: path.basename(outputPath), path: outputPath, url: tab.url, state: 'completed', startedAt: Date.now() });
    sendDownloadsUpdate();
    printWindow?.close();
    openDownloadsWindow();
  } catch (err) {
    console.error('Ctrl+P printToPDF failed:', err);
  }
});
ipcMain.handle('print:cancel', () => printWindow?.close());

ipcMain.handle('ui:set-overlay-height', (_e, px) => {
  overlayReserved = typeof px === 'number' && px > 0 ? px : 0;
  layoutActiveView();
});

ipcMain.handle('find:start', (_e, text) => {
  const tab = getActiveTab();
  if (!tab) return;
  if (text) tab.view.webContents.findInPage(text);
  else tab.view.webContents.stopFindInPage('clearSelection');
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
  loadBookmarks();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
