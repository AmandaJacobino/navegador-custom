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
    el.innerHTML = `
      <span class="title">${tab.title || 'Nova aba'}</span>
      ${soundIcon ? `<span class="mute-icon" title="${tab.muted ? 'Ativar som' : 'Mutar aba'}">${soundIcon}</span>` : ''}
      <span class="close" data-id="${tab.id}">✕</span>
    `;
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
btnBookmark.addEventListener('click', () => {
  const rect = btnBookmark.getBoundingClientRect();
  window.browserAPI.showBookmarkMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) });
});

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
