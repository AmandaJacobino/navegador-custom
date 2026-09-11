const list = document.getElementById('list');
const empty = document.getElementById('empty');
const buttons = document.querySelectorAll('#filters button[data-range]');
const clearAllBtn = document.getElementById('clear-all');

let currentRange = 'today';

function formatTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function load(range) {
  currentRange = range;
  const items = await window.historyAPI.getHistory(range);
  list.innerHTML = '';
  empty.hidden = items.length > 0;
  items.forEach((entry) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="entry-title">${entry.title || entry.url}</span>
      <span class="entry-time">${formatTime(entry.timestamp)}</span>
      <span class="entry-delete" title="Excluir">✕</span>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('entry-delete')) {
        window.historyAPI.deleteEntry(entry.id).then(() => load(currentRange));
      } else {
        window.historyAPI.openUrl(entry.url);
      }
    });
    list.appendChild(li);
  });
}

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
