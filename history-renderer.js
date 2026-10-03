const list = document.getElementById('list');
const empty = document.getElementById('empty');
const searchInput = document.getElementById('search');
const buttons = document.querySelectorAll('#filters button[data-range]');
const clearAllBtn = document.getElementById('clear-all');

let currentRange = 'today';
let entries = []; // itens do período atual, antes do filtro de busca

function formatTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Busca case-insensitive por título ou URL, sobre os itens já carregados do período.
function matchesSearch(entry, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (entry.title || '').toLowerCase().includes(q) || entry.url.toLowerCase().includes(q);
}

function render() {
  const query = searchInput.value.trim();
  const items = entries.filter((entry) => matchesSearch(entry, query));
  list.innerHTML = '';
  empty.hidden = items.length > 0;
  items.forEach((entry) => {
    const li = document.createElement('li');

    // textContent (e não innerHTML): títulos vêm de páginas web arbitrárias.
    const main = document.createElement('div');
    main.className = 'entry-main';
    const title = document.createElement('span');
    title.className = 'entry-title';
    title.textContent = entry.title || entry.url;
    const url = document.createElement('span');
    url.className = 'entry-url';
    url.textContent = entry.url;
    const time = document.createElement('span');
    time.className = 'entry-time';
    time.textContent = formatTime(entry.timestamp);
    main.append(title, url, time);

    const del = document.createElement('span');
    del.className = 'entry-delete';
    del.title = 'Excluir';
    del.textContent = '✕';

    li.append(main, del);
    li.addEventListener('click', (e) => {
      if (e.target === del) {
        window.historyAPI.deleteEntry(entry.id).then(() => load(currentRange));
      } else {
        window.historyAPI.openUrl(entry.url);
      }
    });
    list.appendChild(li);
  });
}

async function load(range) {
  currentRange = range;
  entries = await window.historyAPI.getHistory(range);
  render();
}

searchInput.addEventListener('input', render);

buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    buttons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    load(btn.dataset.range);
  });
});

clearAllBtn.addEventListener('click', () => {
  window.historyAPI.clearAll().then(() => load(currentRange));
});

load('today');
