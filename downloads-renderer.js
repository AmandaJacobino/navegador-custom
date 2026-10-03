const list = document.getElementById('list');
const empty = document.getElementById('empty');

function render(items) {
  list.innerHTML = '';
  empty.hidden = items.length > 0;
  items.forEach((entry) => {
    const li = document.createElement('li');
    // textContent e não innerHTML: o nome do arquivo vem da página baixada.
    const filename = document.createElement('span');
    filename.className = 'entry-filename';
    filename.title = entry.path;
    filename.textContent = entry.filename;
    const state = document.createElement('span');
    state.className = 'entry-state';
    state.textContent = entry.state;
    li.append(filename, state);
    li.addEventListener('click', () => window.downloadsAPI.openInFolder(entry.path));
    list.appendChild(li);
  });
}

window.downloadsAPI.onUpdate(render);
window.downloadsAPI.getDownloads().then(render);
