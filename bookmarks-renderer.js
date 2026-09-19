const tree = document.getElementById('tree');
const empty = document.getElementById('empty');
const newFolderBtn = document.getElementById('new-folder-btn');
const newFolderRow = document.getElementById('new-folder-row');

let items = [];

// Mover um favorito arrastando pra uma pasta (issue #9) via mouse events em
// vez do drag-and-drop HTML5 nativo — mesmo problema documentado em
// renderer.js pra reordenar abas: no Linux/Wayland o DnD nativo do Chromium
// trava a janela (dragend/drop não disparam de forma confiável).
let dragBookmark = null; // { id, el, hoverRow, moved }
let suppressNextClick = false;

function onBookmarkDragMove(e) {
  if (!dragBookmark) return;
  if (!dragBookmark.moved) {
    if (Math.abs(e.clientX - dragBookmark.startX) < 5 && Math.abs(e.clientY - dragBookmark.startY) < 5) return;
    dragBookmark.moved = true;
    dragBookmark.el.classList.add('dragging');
  }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const folderRow = target ? target.closest('[data-drop-folder-id]') : null;
  if (dragBookmark.hoverRow && dragBookmark.hoverRow !== folderRow) {
    dragBookmark.hoverRow.classList.remove('drag-over');
  }
  if (folderRow) folderRow.classList.add('drag-over');
  dragBookmark.hoverRow = folderRow;
}

function onBookmarkDragEnd(e) {
  document.removeEventListener('mousemove', onBookmarkDragMove);
  document.removeEventListener('mouseup', onBookmarkDragEnd);
  if (dragBookmark?.moved) {
    suppressNextClick = true;
    dragBookmark.el.classList.remove('dragging');
    if (dragBookmark.hoverRow) {
      dragBookmark.hoverRow.classList.remove('drag-over');
      const folderId = Number(dragBookmark.hoverRow.dataset.dropFolderId);
      window.bookmarksAPI.move(dragBookmark.id, folderId).then(load);
    } else {
      // Soltar em área vazia da árvore (fora de qualquer pasta) volta o
      // favorito pra raiz; soltar fora da árvore inteira cancela.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target?.closest('#tree')) window.bookmarksAPI.move(dragBookmark.id, null).then(load);
    }
  }
  dragBookmark = null;
}

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
    <div class="row bookmark-row">
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
  row.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('select') || e.target.closest('button')) return;
    dragBookmark = { id: entry.id, el: row, startX: e.clientX, startY: e.clientY, moved: false, hoverRow: null };
    document.addEventListener('mousemove', onBookmarkDragMove);
    document.addEventListener('mouseup', onBookmarkDragEnd);
  });

  li.querySelector('.entry-title').addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    editInline(e.target, entry.title || entry.url, (title) => window.bookmarksAPI.rename(entry.id, title).then(load));
  });
  li.querySelector('.entry-url').addEventListener('click', () => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    window.bookmarksAPI.openUrl(entry.url);
  });
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

window.bookmarksAPI.onUpdate(render);
load();
