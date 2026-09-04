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
    el.innerHTML = `
      <span class="title">${tab.title || 'Nova aba'}</span>
      <span class="close" data-id="${tab.id}">✕</span>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('close')) {
        window.browserAPI.closeTab(tab.id);
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
