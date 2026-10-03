const tabbar = document.getElementById('tabbar');
const newTabBtn = document.getElementById('new-tab-btn');
const address = document.getElementById('address');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const btnBookmark = document.getElementById('btn-bookmark');

let currentState = { tabs: [], activeTabId: null, canGoBack: false, canGoForward: false };

// Reordenar abas (issue #7) via mouse events em vez do drag-and-drop HTML5
// nativo: o `-webkit-app-region: drag` da janela conflita com o DnD nativo
// no Linux/Wayland (o SO "rouba" o gesto e o dragend nunca dispara,
// travando as abas). Mouse events dão controle total, sem esse problema.
let dragTab = null; // { id, el, startX, startBaseLeft, moved }
let suppressNextClick = false;

// A aba arrastada segue o cursor via transform (não tira layout flow), e o
// DOM é reordenado ao vivo assim que o cursor cruza a metade de um vizinho
// — clássico algoritmo de swap por ponto médio. Sempre que reordenamos, a
// posição "de repouso" (sem transform) muda, então recompensamos o
// transform pra aba não pular visualmente na tela.
function onDragMove(e) {
  if (!dragTab) return;
  if (!dragTab.moved) {
    if (Math.abs(e.clientX - dragTab.startX) < 5) return;
    dragTab.moved = true;
    dragTab.startBaseLeft = dragTab.el.getBoundingClientRect().left;
    dragTab.el.classList.add('dragging');
  }

  const siblings = Array.from(tabbar.querySelectorAll('.tab')).filter((el) => el !== dragTab.el);
  let afterElement = null;
  for (const sib of siblings) {
    const box = sib.getBoundingClientRect();
    if (e.clientX < box.left + box.width / 2) { afterElement = sib; break; }
  }
  const wantsNode = afterElement || newTabBtn;
  if (dragTab.el.nextSibling !== wantsNode) {
    tabbar.insertBefore(dragTab.el, wantsNode);
  }

  dragTab.el.style.transform = 'none';
  const baseLeft = dragTab.el.getBoundingClientRect().left;
  const dx = e.clientX - dragTab.startX;
  dragTab.el.style.transform = `translateX(${dragTab.startBaseLeft + dx - baseLeft}px)`;
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (dragTab?.moved) {
    suppressNextClick = true;
    dragTab.el.style.transform = '';
    dragTab.el.classList.remove('dragging');
    const ids = Array.from(tabbar.querySelectorAll('.tab')).map((el) => Number(el.dataset.id));
    window.browserAPI.reorderTabs(ids);
  }
  dragTab = null;
}

function render() {
  // Remove abas antigas (mantém o botão de nova aba)
  tabbar.querySelectorAll('.tab').forEach((el) => el.remove());

  currentState.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === currentState.activeTabId ? ' active' : '');
    el.dataset.id = tab.id;
    const soundIcon = tab.muted ? '🔇' : tab.audible ? '🔊' : '';
    // textContent e não innerHTML: o título vem da página web, que controla o texto.
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title || 'Nova aba';
    el.append(title);
    if (soundIcon) {
      const mute = document.createElement('span');
      mute.className = 'mute-icon';
      mute.title = tab.muted ? 'Ativar som' : 'Mutar aba';
      mute.textContent = soundIcon;
      el.append(mute);
    }
    const close = document.createElement('span');
    close.className = 'close';
    close.dataset.id = tab.id;
    close.textContent = '✕';
    el.append(close);
    el.addEventListener('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (e.target.classList.contains('close')) {
        window.browserAPI.closeTab(tab.id);
      } else if (e.target.classList.contains('mute-icon')) {
        window.browserAPI.toggleMute(tab.id);
      } else {
        window.browserAPI.activateTab(tab.id);
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.close') || e.target.closest('.mute-icon')) return;
      dragTab = { id: tab.id, startX: e.clientX, moved: false, el };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });
    tabbar.insertBefore(el, newTabBtn);
  });

  const active = currentState.tabs.find((t) => t.id === currentState.activeTabId);
  if (active && document.activeElement !== address) {
    address.value = active.url || '';
  }

  btnBack.disabled = !currentState.canGoBack;
  btnForward.disabled = !currentState.canGoForward;

  const bookmarked = !!active?.bookmarked;
  btnBookmark.textContent = bookmarked ? '★' : '☆';
  btnBookmark.classList.toggle('active', bookmarked);
}

window.browserAPI.onTabsUpdate((state) => {
  currentState = state;
  render();
});

newTabBtn.addEventListener('click', () => window.browserAPI.newTab());
btnBack.addEventListener('click', () => window.browserAPI.back());
btnForward.addEventListener('click', () => window.browserAPI.forward());
btnReload.addEventListener('click', () => window.browserAPI.reload());
// Primeiro clique adiciona a página aos favoritos; com ela já favoritada, o
// clique abre o dropdown (ver openBookmarkMenu em main.js), empilhado por
// cima da página ativa como BrowserView de overlay.
btnBookmark.addEventListener('click', () => {
  const active = currentState.tabs.find((t) => t.id === currentState.activeTabId);
  if (!active?.bookmarked) {
    window.browserAPI.toggleBookmark();
    return;
  }
  const rect = btnBookmark.getBoundingClientRect();
  window.browserAPI.openBookmarkMenu({
    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
  });
});
// Rede de segurança: se o arraste do gerenciador de favoritos (ver
// bookmarks-renderer.js) terminar com o cursor sobre a toolbar em vez de
// sobre o próprio painel, esse mouseup nunca chegaria à view dele.
document.addEventListener('mouseup', () => window.browserAPI.endPanelDrag());

address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.browserAPI.go(address.value);
    address.blur();
  }
});

// --- Atalhos de teclado (issue #6): busca e histórico ---
// Altura precisa bater com o CSS de #findbar em index.html — é o valor
// usado pra empurrar o BrowserView pra baixo e revelar o painel.
const FINDBAR_HEIGHT = 40;

const findbar = document.getElementById('findbar');
const findInput = document.getElementById('find-input');
const findNextBtn = document.getElementById('find-next');
const findPrevBtn = document.getElementById('find-prev');
const findCloseBtn = document.getElementById('find-close');

function hideOverlays() {
  findbar.classList.add('hidden');
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideOverlays();
});
