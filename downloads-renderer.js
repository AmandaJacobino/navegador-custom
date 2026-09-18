const list = document.getElementById('list');
const empty = document.getElementById('empty');

function render(items) {
  list.innerHTML = '';
  empty.hidden = items.length > 0;
  items.forEach((entry) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="entry-filename" title="${entry.path}">${entry.filename}</span>
      <span class="entry-state">${entry.state}</span>
    `;
    li.addEventListener('click', () => window.downloadsAPI.openInFolder(entry.path));
    list.appendChild(li);
  });
}

window.downloadsAPI.onUpdate(render);
window.downloadsAPI.getDownloads().then(render);
