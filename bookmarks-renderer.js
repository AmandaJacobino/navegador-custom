const tree = document.getElementById('tree');
const empty = document.getElementById('empty');
const newFolderBtn = document.getElementById('new-folder-btn');
const newFolderRow = document.getElementById('new-folder-row');

let items = [];

function folderOptions(excludeId) {
  const folders = items.filter((b) => b.type === 'folder' && b.id !== excludeId);
  const options = ['<option value="">Raiz</option>']
    .concat(folders.map((f) => `<option value="${f.id}">${f.title}</option>`));
  return options.join('');
}

// Substitui um elemento por um <input> inline pra edição (Electron não
// implementa window.prompt() no Linux — ele retorna null sem abrir diálogo
// nenhum, então toda edição de texto aqui precisa ser feita in-page).
function editInline(anchorEl, initialValue, onSubmit) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initialValue;
  input.className = 'inline-edit';
  anchorEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (commit && value) onSubmit(value);
    else load();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// Formulário inline de "nova pasta/subpasta", inserido logo após o botão
// que o abriu.
function showNewFolderForm(afterEl, parentId) {
  const existing = document.querySelector('.new-folder-form');
  if (existing) existing.remove();

  const form = document.createElement('div');
  form.className = 'row new-folder-form';
  form.innerHTML = `<input type="text" placeholder="Nome da pasta" /> <button class="confirm-btn">Criar</button>`;
  afterEl.insertAdjacentElement('afterend', form);

  const input = form.querySelector('input');
  const confirmBtn = form.querySelector('.confirm-btn');
  input.focus();
  let submitted = false;
  const submit = () => {
    if (submitted) return;
    const title = input.value.trim();
    if (!title) { form.remove(); return; }
    submitted = true;
    confirmBtn.disabled = true;
    // O formulário de pasta na raiz fica fora de #tree (fica ao lado do
    // botão "+ Nova pasta"), então o load() abaixo — que só redesenha
    // #tree e #speeddial — não o remove sozinho.
    window.bookmarksAPI.addFolder(title, parentId).then(() => {
      form.remove();
      load();
    });
  };
  confirmBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') form.remove();
  });
}

function countDescendants(folderId) {
  const direct = items.filter((b) => b.parentId === folderId);
  return direct.reduce((total, item) => {
    return total + 1 + (item.type === 'folder' ? countDescendants(item.id) : 0);
  }, 0);
}

function renderBookmarkRow(entry) {
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="row bookmark-row" draggable="true">
      <div class="row-main">
        <span class="bookmark-dot">●</span>
        <span class="entry-title" title="Renomear">${entry.title || entry.url}</span>
        <button class="speeddial-toggle ${entry.speedDial ? 'active' : ''}" title="Tela inicial">★</button>
        <select class="move-select" title="Mover para pasta"></select>
        <button class="delete-btn" title="Remover">✕</button>
      </div>
      <span class="entry-url">${entry.url}</span>
    </div>
  `;
  const row = li.querySelector('.row');
  const moveSelect = li.querySelector('.move-select');
  moveSelect.innerHTML = folderOptions(null);
  moveSelect.value = entry.parentId ?? '';

  // Arrastar um favorito pra cima de uma pasta move ele pra lá — o select
  // continua funcionando como alternativa (útil quando a pasta de destino
  // tem muitos itens e mirar nela com o mouse fica ruim).
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(entry.id));
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));

  li.querySelector('.entry-title').addEventListener('click', (e) => {
    editInline(e.target, entry.title || entry.url, (title) => window.bookmarksAPI.rename(entry.id, title).then(load));
  });
  li.querySelector('.entry-url').addEventListener('click', () => window.bookmarksAPI.openUrl(entry.url));
  li.querySelector('.speeddial-toggle').addEventListener('click', () => {
    window.bookmarksAPI.toggleSpeedDial(entry.id).then(load);
  });
  moveSelect.addEventListener('change', () => {
    const parentId = moveSelect.value ? Number(moveSelect.value) : null;
    window.bookmarksAPI.move(entry.id, parentId).then(load);
  });
  li.querySelector('.delete-btn').addEventListener('click', () => {
    window.bookmarksAPI.remove(entry.id).then(load);
  });
  return li;
}

function renderFolderNode(folder) {
  const li = document.createElement('li');
  const count = countDescendants(folder.id);
  li.innerHTML = `
    <div class="row" data-drop-folder-id="${folder.id}">
      <span class="folder-icon">▸</span>
      <span class="folder-title" title="Renomear">${folder.title}</span>
      <span class="folder-count">${count}</span>
      <select class="move-select" title="Mover para pasta"></select>
      <button class="add-sub-btn" title="Nova subpasta">+</button>
      <button class="delete-btn" title="Remover pasta">✕</button>
    </div>
  `;
  const row = li.querySelector('.row');
  const moveSelect = li.querySelector('.move-select');
  moveSelect.innerHTML = folderOptions(folder.id);
  moveSelect.value = folder.parentId ?? '';

  // Pasta é alvo de drop: destaca enquanto um favorito é arrastado por
  // cima e move ao soltar. stopPropagation evita que o drop "vaze" pro
  // container raiz (#tree), que trataria como "mover pra raiz".
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) window.bookmarksAPI.move(id, folder.id).then(load);
  });

  li.querySelector('.folder-title').addEventListener('click', (e) => {
    editInline(e.target, folder.title, (title) => window.bookmarksAPI.rename(folder.id, title).then(load));
  });
  moveSelect.addEventListener('change', () => {
    const parentId = moveSelect.value ? Number(moveSelect.value) : null;
    window.bookmarksAPI.move(folder.id, parentId).then(load);
  });
  li.querySelector('.add-sub-btn').addEventListener('click', () => showNewFolderForm(row, folder.id));
  li.querySelector('.delete-btn').addEventListener('click', () => {
    window.bookmarksAPI.remove(folder.id).then(load);
  });

  const childList = document.createElement('ul');
  renderLevel(childList, folder.id);
  li.appendChild(childList);
  return li;
}

function renderLevel(container, parentId) {
  const children = items.filter((b) => (b.parentId ?? null) === parentId);
  children.filter((b) => b.type === 'folder').forEach((f) => container.appendChild(renderFolderNode(f)));
  children.filter((b) => b.type === 'bookmark').forEach((b) => container.appendChild(renderBookmarkRow(b)));
}

function render(list) {
  items = list;

  empty.hidden = items.length > 0;
  tree.innerHTML = '';
  renderLevel(tree, null);
}

async function load() {
  render(await window.bookmarksAPI.getAll());
}

newFolderBtn.addEventListener('click', () => showNewFolderForm(newFolderRow, null));

// Soltar um favorito em qualquer área vazia da árvore (fora de uma pasta)
// move ele pra raiz. Pastas fazem stopPropagation no próprio drop, então
// isso só dispara quando o drop não caiu em cima de nenhuma.
tree.addEventListener('dragover', (e) => e.preventDefault());
tree.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = Number(e.dataTransfer.getData('text/plain'));
  if (id) window.bookmarksAPI.move(id, null).then(load);
});

window.bookmarksAPI.onUpdate(render);
load();
