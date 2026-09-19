const list = document.getElementById('list');
const empty = document.getElementById('empty');

function render(items) {
  list.innerHTML = '';
  empty.hidden = items.length > 0;
  items.forEach((entry) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="entry-title">${entry.title || entry.url}</span>
      <span class="entry-url">${entry.url}</span>
      <span class="entry-delete" title="Remover">✕</span>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('entry-delete')) {
        window.bookmarksAPI.remove(entry.id).then(load);
      } else {
        window.bookmarksAPI.openUrl(entry.url);
      }
    });
    list.appendChild(li);
  });
}

async function load() {
  render(await window.bookmarksAPI.getAll());
}

window.bookmarksAPI.onUpdate(render);
load();
