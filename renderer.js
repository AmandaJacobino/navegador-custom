const tabbar = document.getElementById('tabbar');
const newTabBtn = document.getElementById('new-tab-btn');
const address = document.getElementById('address');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');

let currentState = { tabs: [], activeTabId: null, canGoBack: false, canGoForward: false };

function render() {
  // Remove abas antigas (mantém o botão de nova aba)
  tabbar.querySelectorAll('.tab').forEach((el) => el.remove());

  currentState.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === currentState.activeTabId ? ' active' : '');
    const soundIcon = tab.muted ? '🔇' : tab.audible ? '🔊' : '';
    el.innerHTML = `
      <span class="title">${tab.title || 'Nova aba'}</span>
      ${soundIcon ? `<span class="mute-icon" title="${tab.muted ? 'Ativar som' : 'Mutar aba'}">${soundIcon}</span>` : ''}
      <span class="close" data-id="${tab.id}">✕</span>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('close')) {
        window.browserAPI.closeTab(tab.id);
      } else if (e.target.classList.contains('mute-icon')) {
        window.browserAPI.toggleMute(tab.id);
      } else {
        window.browserAPI.activateTab(tab.id);
      }
    });
    tabbar.insertBefore(el, newTabBtn);
  });

  const active = currentState.tabs.find((t) => t.id === currentState.activeTabId);
  if (active && document.activeElement !== address) {
    address.value = active.url || '';
  }

  btnBack.disabled = !currentState.canGoBack;
  btnForward.disabled = !currentState.canGoForward;
}

window.browserAPI.onTabsUpdate((state) => {
  currentState = state;
  render();
});

newTabBtn.addEventListener('click', () => window.browserAPI.newTab());
btnBack.addEventListener('click', () => window.browserAPI.back());
btnForward.addEventListener('click', () => window.browserAPI.forward());
btnReload.addEventListener('click', () => window.browserAPI.reload());

address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.browserAPI.go(address.value);
    address.blur();
  }
});

// --- Atalhos de teclado (issue #6): busca, histórico e downloads ---
// Alturas precisam bater com o CSS de #findbar/.panel em index.html —
// é o valor usado pra empurrar o BrowserView pra baixo e revelar o painel.
const FINDBAR_HEIGHT = 40;
const PANEL_HEIGHT = 220;

const findbar = document.getElementById('findbar');
const findInput = document.getElementById('find-input');
const findNextBtn = document.getElementById('find-next');
const findPrevBtn = document.getElementById('find-prev');
const findCloseBtn = document.getElementById('find-close');

const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const downloadsClose = document.getElementById('downloads-close');

function hideOverlays() {
  findbar.classList.add('hidden');
  downloadsPanel.classList.add('hidden');
  window.browserAPI.setOverlayHeight(0);
  window.browserAPI.findStop();
}

window.browserAPI.onFocusAddress(() => {
  address.focus();
  address.select();
});

window.browserAPI.onToggleFindbar(() => {
  const wasHidden = findbar.classList.contains('hidden');
  hideOverlays();
  if (wasHidden) {
    findbar.classList.remove('hidden');
    window.browserAPI.setOverlayHeight(FINDBAR_HEIGHT);
    findInput.focus();
  }
});

findInput.addEventListener('input', () => window.browserAPI.findStart(findInput.value));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') window.browserAPI.findNext(findInput.value);
  if (e.key === 'Escape') hideOverlays();
});
findNextBtn.addEventListener('click', () => window.browserAPI.findNext(findInput.value));
findPrevBtn.addEventListener('click', () => window.browserAPI.findPrev(findInput.value));
findCloseBtn.addEventListener('click', hideOverlays);

function renderDownloads(items) {
  downloadsList.innerHTML = '';
  items.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.filename} — ${entry.state}`;
    li.title = entry.path;
    downloadsList.appendChild(li);
  });
}

window.browserAPI.onToggleDownloads((items) => {
  const wasHidden = downloadsPanel.classList.contains('hidden');
  hideOverlays();
  if (wasHidden) {
    renderDownloads(items);
    downloadsPanel.classList.remove('hidden');
    window.browserAPI.setOverlayHeight(PANEL_HEIGHT);
  }
});
downloadsClose.addEventListener('click', hideOverlays);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideOverlays();
});
