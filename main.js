const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');

// Altura da barra de UI (abas + endereço) em pixels.
// As páginas web (BrowserView) começam abaixo dessa altura.
const UI_HEIGHT = 84;

let mainWindow;
let tabs = [];      // cada item: { id, view, title, url }
let activeTabId = null;
let nextTabId = 1;

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

function layoutActiveView() {
  const tab = getActiveTab();
  if (!tab) return;
  const bounds = mainWindow.getContentBounds();
  tab.view.setBounds({
    x: 0,
    y: UI_HEIGHT,
    width: bounds.width,
    height: bounds.height - UI_HEIGHT,
  });
}

function sendTabsUpdate() {
  const tab = getActiveTab();
  mainWindow.webContents.send('tabs:update', {
    tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
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

  const tab = { id, view, title: 'Nova aba', url };
  tabs.push(tab);

  view.webContents.on('page-title-updated', (_e, title) => {
    tab.title = title;
    sendTabsUpdate();
  });
  view.webContents.on('did-navigate', (_e, navUrl) => {
    tab.url = navUrl;
    sendTabsUpdate();
  });
  view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
    tab.url = navUrl;
    sendTabsUpdate();
  });

  view.webContents.loadURL(url);
  activateTab(id);
  return id;
}

function activateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  layoutActiveView();
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

  mainWindow.webContents.on('did-finish-load', () => {
    createTab();
  });
}

// --- Comunicação com a interface (renderer.js) ---

ipcMain.handle('tabs:new', () => createTab());
ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
ipcMain.handle('tabs:activate', (_e, id) => activateTab(id));

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

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
