const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const HISTORY_PRELOAD = path.join(__dirname, 'history-preload.js');
const DOWNLOADS_PRELOAD = path.join(__dirname, 'downloads-preload.js');
const PRINT_PRELOAD = path.join(__dirname, 'print-preload.js');
const BOOKMARKS_PRELOAD = path.join(__dirname, 'bookmarks-preload.js');
const BOOKMARK_MENU_PRELOAD = path.join(__dirname, 'bookmark-menu-preload.js');
const BOOKMARKS_FILE = path.join(app.getPath('userData'), 'bookmarks.json');

// Altura da barra de UI (abas + endereço) em pixels.
// As páginas web (BrowserView) começam abaixo dessa altura.
const UI_HEIGHT = 84;

let mainWindow;
let historyWindow = null;   // janela independente de histórico (Ctrl+H)
let downloadsWindow = null; // janela independente de downloads (Ctrl+D)
let bookmarksManagerView = null; // overlay de gerenciamento de favoritos (Ctrl+B)
let bookmarksManagerOpen = false;
let bookmarksManagerMoved = false; // já foi arrastado manualmente? não recentralizar mais
let bookmarksManagerDragging = false;
let bookmarksManagerDragStartCursor = null;
let bookmarksManagerDragStartBounds = null;
let bookmarksManagerDragInterval = null;
let bookmarkMenuView = null; // BrowserView de overlay do dropdown da estrela
let bookmarkMenuOpen = false;
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

// Gerenciador de favoritos (issue #9, Ctrl+B) como overlay preso à janela
// principal, no mesmo esquema do dropdown da estrela — assim ele nunca fica
// "perdido" atrás de outra janela quando o foco sai e volta pro navegador,
// já que não existe enquanto BrowserWindow independente pro SO gerenciar.
function ensureBookmarksManagerView() {
  if (bookmarksManagerView) return bookmarksManagerView;
  bookmarksManagerView = new BrowserView({
    webPreferences: {
      preload: BOOKMARKS_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  bookmarksManagerView.webContents.loadFile('bookmarks.html');
  bookmarksManagerView.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      closeBookmarksManager();
    } else if (input.control && input.key.toLowerCase() === 'n') {
      event.preventDefault();
      bookmarksManagerView.webContents.send('bookmarks:new-folder-shortcut');
    }
  });
  return bookmarksManagerView;
}

function layoutBookmarksManager() {
  if (!bookmarksManagerOpen || !mainWindow) return;
  const contentBounds = mainWindow.getContentBounds();
  if (!bookmarksManagerMoved) {
    const width = 480;
    const height = Math.min(600, Math.max(200, contentBounds.height - UI_HEIGHT - 32));
    const x = Math.max(0, Math.round((contentBounds.width - width) / 2));
    const y = UI_HEIGHT + Math.max(0, Math.round((contentBounds.height - UI_HEIGHT - height) / 2));
    bookmarksManagerView.setBounds({ x, y, width, height });
    return;
  }
  // Já foi arrastado pelo usuário: não recentraliza mais, só reencaixa
  // dentro da janela se o redimensionamento deixou a view total ou
  // parcialmente pra fora.
  const current = bookmarksManagerView.getBounds();
  const x = Math.min(Math.max(current.x, 0), Math.max(0, contentBounds.width - current.width));
  const y = Math.min(Math.max(current.y, UI_HEIGHT), Math.max(UI_HEIGHT, contentBounds.height - current.height));
  if (x !== current.x || y !== current.y) bookmarksManagerView.setBounds({ ...current, x, y });
}

function openBookmarksManager() {
  const view = ensureBookmarksManagerView();
  if (!bookmarksManagerOpen) {
    mainWindow.addBrowserView(view);
    bookmarksManagerOpen = true;
    layoutBookmarksManager();
  }
  view.webContents.focus();
}

function closeBookmarksManager() {
  if (!bookmarksManagerOpen || !mainWindow) return;
  stopBookmarksManagerDrag();
  bookmarksManagerOpen = false;
  mainWindow.removeBrowserView(bookmarksManagerView);
}

// Arrastar o overlay pelo cabeçalho: a BrowserView não é uma janela do SO,
// então não existe "-webkit-app-region: drag" pra ela. Em vez de depender
// de mousemove dentro do próprio documento (que para de chegar assim que o
// cursor sai do retângulo da view), o processo principal consulta a posição
// absoluta do cursor na tela periodicamente — funciona mesmo se o arraste
// sair da área da view.
function startBookmarksManagerDrag() {
  if (!bookmarksManagerOpen || bookmarksManagerDragging) return;
  bookmarksManagerDragging = true;
  bookmarksManagerMoved = true;
  bookmarksManagerDragStartCursor = screen.getCursorScreenPoint();
  bookmarksManagerDragStartBounds = bookmarksManagerView.getBounds();
  bookmarksManagerDragInterval = setInterval(() => {
    if (!bookmarksManagerDragging || !mainWindow) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - bookmarksManagerDragStartCursor.x;
    const dy = cursor.y - bookmarksManagerDragStartCursor.y;
    const { width, height } = bookmarksManagerDragStartBounds;
    const contentBounds = mainWindow.getContentBounds();
    const x = Math.min(Math.max(bookmarksManagerDragStartBounds.x + dx, 0), Math.max(0, contentBounds.width - width));
    const y = Math.min(Math.max(bookmarksManagerDragStartBounds.y + dy, UI_HEIGHT), Math.max(UI_HEIGHT, contentBounds.height - height));
    bookmarksManagerView.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  }, 16);
}

function stopBookmarksManagerDrag() {
  if (!bookmarksManagerDragging) return;
  bookmarksManagerDragging = false;
  clearInterval(bookmarksManagerDragInterval);
  bookmarksManagerDragInterval = null;
}

const BOOKMARK_MENU_WIDTH = 220;

// Dropdown da estrela como uma segunda BrowserView, empilhada por cima da
// BrowserView da página ativa. A página é uma camada nativa própria que
// sempre desenha por cima do HTML da janela principal — nenhum popover em
// index.html conseguiria aparecer acima dela. Empilhar outra BrowserView é
// a única forma de sobrepor sem empurrar/esconder o conteúdo da página.
function ensureBookmarkMenuView() {
  if (bookmarkMenuView) return bookmarkMenuView;
  bookmarkMenuView = new BrowserView({
    webPreferences: {
      preload: BOOKMARK_MENU_PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  bookmarkMenuView.webContents.loadFile('bookmark-menu.html');
  bookmarkMenuView.webContents.on('blur', closeBookmarkMenu);
  bookmarkMenuView.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') closeBookmarkMenu();
  });
  return bookmarkMenuView;
}

let bookmarkMenuClosedAt = 0;

function openBookmarkMenu(anchorRect) {
  if (bookmarkMenuOpen) { closeBookmarkMenu(); return; }
  // Clicar de novo na estrela pra fechar tira o foco da view antes do clique
  // chegar aqui: o 'blur' já fechou o menu (bookmarkMenuOpen virou false) e,
  // sem essa guarda, este mesmo clique reabriria o dropdown na sequência.
  if (Date.now() - bookmarkMenuClosedAt < 250) return;
  const tab = getActiveTab();
  if (!tab || !mainWindow) return;
  const view = ensureBookmarkMenuView();
  mainWindow.addBrowserView(view);
  bookmarkMenuOpen = true;
  view.webContents.send('bookmark-menu:show', { bookmarked: isBookmarked(tab.url), speedDial: isSpeedDial(tab.url) });
  const width = BOOKMARK_MENU_WIDTH;
  const contentBounds = mainWindow.getContentBounds();
  view.setBounds({ x: 0, y: 0, width, height: 10 });
  view.webContents.executeJavaScript('document.body.offsetHeight').then((height) => {
    if (!bookmarkMenuOpen) return; // fechado antes de terminar de medir
    const spaceBelow = contentBounds.height - anchorRect.bottom;
    const top = spaceBelow >= height ? anchorRect.bottom + 4 : Math.max(UI_HEIGHT, anchorRect.top - height - 4);
    // -14 pra não invadir a faixa da barra de rolagem da página, que fica
    // colada na borda direita do conteúdo.
    const left = Math.min(anchorRect.right - width - 6, contentBounds.width - width - 10);
    view.setBounds({ x: Math.max(0, Math.round(left)), y: Math.round(top), width, height: Math.ceil(height) });
    view.webContents.focus();
  });
}

function closeBookmarkMenu() {
  if (!bookmarkMenuOpen || !mainWindow) return;
  bookmarkMenuOpen = false;
  bookmarkMenuClosedAt = Date.now();
  mainWindow.removeBrowserView(bookmarkMenuView);
}

// bookmarks é uma lista plana de itens em árvore: cada um é um favorito
// { id, type: 'bookmark', title, url, speedDial, parentId, createdAt } ou
// uma pasta { id, type: 'folder', title, parentId, createdAt }.
// parentId null = nível raiz. A UI (bookmarks-renderer.js) monta a árvore
// a partir dessa lista plana.
function loadBookmarks() {
  try {
    const raw = fs.readFileSync(BOOKMARKS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migra o formato antigo (favorito plano sem type/parentId/speedDial).
    bookmarks = parsed.map((b) => ({
      type: 'bookmark',
      parentId: null,
      speedDial: false,
      ...b,
    }));
    nextBookmarkId = bookmarks.reduce((max, b) => Math.max(max, b.id), 0) + 1;
    healBrokenParentChains();
  } catch {
    bookmarks = [];
  }
}

// Uma pasta cujo caminho de parentId nunca chega em null (raiz) está num
// ciclo — duas pastas apontando uma pra outra como pai, por exemplo — e
// fica invisível na árvore junto com tudo que estiver dentro dela. Isso
// não deveria acontecer (moveItem recusa criar ciclos novos), mas se um
// arquivo antigo já veio corrompido, resolve movendo essas pastas de
// volta pra raiz em vez de deixá-las (e seu conteúdo) somem sem explicação.
function healBrokenParentChains() {
  const byId = new Map(bookmarks.map((b) => [b.id, b]));
  let healed = false;
  for (const item of bookmarks) {
    if (item.type !== 'folder') continue;
    const seen = new Set();
    let current = item;
    while (current.parentId != null) {
      if (seen.has(current.id)) {
        item.parentId = null;
        healed = true;
        break;
      }
      seen.add(current.id);
      current = byId.get(current.parentId);
      if (!current) { item.parentId = null; healed = true; break; }
    }
  }
  if (healed) saveBookmarks();
}

function saveBookmarks() {
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
}

function sendBookmarksUpdate() {
  if (bookmarksManagerOpen) {
    bookmarksManagerView.webContents.send('bookmarks:update', bookmarks);
  }
}

function findBookmarkByUrl(url) {
  return bookmarks.find((b) => b.type === 'bookmark' && b.url === url);
}

function isBookmarked(url) {
  return !!findBookmarkByUrl(url);
}

function isSpeedDial(url) {
  return !!findBookmarkByUrl(url)?.speedDial;
}

function persistAndBroadcast() {
  saveBookmarks();
  sendBookmarksUpdate();
  sendTabsUpdate();
}

function addBookmark(tab, parentId = null) {
  if (!tab || findBookmarkByUrl(tab.url)) return;
  bookmarks.push({
    id: nextBookmarkId++,
    type: 'bookmark',
    url: tab.url,
    title: tab.title,
    speedDial: false,
    parentId,
    createdAt: Date.now(),
  });
  persistAndBroadcast();
}

function removeBookmarkByUrl(url) {
  const existing = findBookmarkByUrl(url);
  if (!existing) return;
  removeItem(existing.id);
}

// Remove um item (favorito ou pasta). Ao remover uma pasta, remove também
// toda a subárvore — evita deixar filhos "órfãos" apontando pra um
// parentId inexistente.
function removeItem(id) {
  const toRemove = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bookmarks) {
      if (b.parentId != null && toRemove.has(b.parentId) && !toRemove.has(b.id)) {
        toRemove.add(b.id);
        grew = true;
      }
    }
  }
  bookmarks = bookmarks.filter((b) => !toRemove.has(b.id));
  persistAndBroadcast();
}

function renameItem(id, title) {
  const item = bookmarks.find((b) => b.id === id);
  if (!item || !title?.trim()) return;
  item.title = title.trim();
  persistAndBroadcast();
}

// Move uma pasta pra dentro de si mesma ou de uma descendente dela criaria
// um ciclo, que a árvore não consegue mais alcançar a partir da raiz (fica
// invisível na UI, junto com tudo que tiver dentro). Favoritos não têm
// filhos, então nunca podem causar ciclo.
function wouldCreateCycle(id, parentId) {
  let current = parentId;
  while (current != null) {
    if (current === id) return true;
    current = bookmarks.find((b) => b.id === current)?.parentId ?? null;
  }
  return false;
}

function moveItem(id, parentId) {
  const item = bookmarks.find((b) => b.id === id);
  if (!item) return;
  if (item.type === 'folder' && wouldCreateCycle(id, parentId)) return;
  item.parentId = parentId;
  persistAndBroadcast();
}

function addFolder(title, parentId = null) {
  if (!title?.trim()) return;
  bookmarks.push({
    id: nextBookmarkId++,
    type: 'folder',
    title: title.trim(),
    parentId,
    createdAt: Date.now(),
  });
  persistAndBroadcast();
}

// Alterna a marcação de tela inicial (speed dial) da aba informada,
// favoritando-a primeiro se ainda não estiver salva.
function toggleSpeedDial(tab) {
  if (!tab) return;
  let entry = findBookmarkByUrl(tab.url);
  if (!entry) {
    entry = { id: nextBookmarkId++, type: 'bookmark', url: tab.url, title: tab.title, speedDial: false, parentId: null, createdAt: Date.now() };
    bookmarks.push(entry);
  }
  entry.speedDial = !entry.speedDial;
  persistAndBroadcast();
}

function toggleSpeedDialById(id) {
  const item = bookmarks.find((b) => b.id === id && b.type === 'bookmark');
  if (!item) return;
  item.speedDial = !item.speedDial;
  persistAndBroadcast();
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
  closeBookmarkMenu(); // setBrowserView abaixo remove todas as views, inclusive a do dropdown
  mainWindow.setBrowserView(tab.view);
  // setBrowserView troca TODAS as views da janela — se o gerenciador de
  // favoritos estiver aberto, precisa voltar por cima da nova aba, senão
  // trocar de aba com ele aberto o fecharia sem querer.
  if (bookmarksManagerOpen) mainWindow.addBrowserView(bookmarksManagerView);
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
  if (ctrl && key === 'b') { openBookmarksManager(); return true; }
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
  mainWindow.on('resize', closeBookmarkMenu);
  mainWindow.on('resize', layoutBookmarksManager);
  mainWindow.on('blur', stopBookmarksManagerDrag);

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

ipcMain.handle('bookmarks:toggleCurrent', () => {
  const tab = getActiveTab();
  if (!tab) return;
  if (isBookmarked(tab.url)) removeBookmarkByUrl(tab.url);
  else addBookmark(tab);
});
ipcMain.handle('bookmarks:toggleSpeedDialCurrent', () => {
  const tab = getActiveTab();
  if (tab) toggleSpeedDial(tab);
});
ipcMain.handle('bookmarks:openManage', () => openBookmarksManager());
ipcMain.handle('bookmarks:closeManager', () => closeBookmarksManager());
ipcMain.handle('bookmarks:managerDragStart', () => startBookmarksManagerDrag());
ipcMain.handle('bookmarks:managerDragEnd', () => stopBookmarksManagerDrag());
ipcMain.handle('bookmarks:openMenu', (_e, anchorRect) => openBookmarkMenu(anchorRect));
ipcMain.handle('bookmarks:closeMenu', () => closeBookmarkMenu());
ipcMain.handle('bookmarks:get', () => bookmarks);
ipcMain.handle('bookmarks:remove', (_e, id) => removeItem(id));
ipcMain.handle('bookmarks:rename', (_e, id, title) => renameItem(id, title));
ipcMain.handle('bookmarks:move', (_e, id, parentId) => moveItem(id, parentId));
ipcMain.handle('bookmarks:addFolder', (_e, title, parentId) => addFolder(title, parentId));
ipcMain.handle('bookmarks:toggleSpeedDial', (_e, id) => toggleSpeedDialById(id));

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
