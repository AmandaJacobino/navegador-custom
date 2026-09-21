const tree = document.getElementById('tree');
const empty = document.getElementById('empty');
const newFolderBtn = document.getElementById('new-folder-btn');
const newFolderRow = document.getElementById('new-folder-row');

let items = [];
const collapsedFolders = new Set();

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

function folderLabel(parentId) {
  if (parentId == null) return 'Raiz';
  const folder = items.find((b) => b.id === parentId && b.type === 'folder');
  return folder ? folder.title : 'Raiz';
}

// Uma pasta não pode ir pra dentro de si mesma nem de uma subpasta dela —
// criaria um ciclo que a torna inalcançável a partir da raiz (e some com
// tudo que tiver dentro). Calcula o próprio id + todos os descendentes pra
// excluir do dropdown, em vez de deixar a pessoa escolher e falhar depois.
function folderAndDescendantIds(folderId) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of items) {
      if (b.type === 'folder' && ids.has(b.parentId) && !ids.has(b.id)) {
        ids.add(b.id);
        grew = true;
      }
    }
  }
  return ids;
}

// Posiciona o painel do dropdown como position:fixed calculado à mão, em
// vez de CSS anchor positioning (position-area) — o Chromium do Electron
// 31 está bem na borda do suporte a essa feature, então preferimos o modo
// manual, que a própria spec do Popover cita como alternativa válida.
function positionFolderPanel(trigger, panel) {
  const rect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow >= panelRect.height || spaceBelow >= rect.top
    ? rect.bottom + 4
    : rect.top - panelRect.height - 4;
  panel.style.top = `${Math.max(4, top)}px`;
  panel.style.left = `${Math.min(rect.left, window.innerWidth - panelRect.width - 8)}px`;
}

// Dropdown customizado pra mover um item (favorito ou pasta) pra outra
// pasta, usando a Popover API (suportada desde o Chrome 116, então
// funciona no Chromium do Electron 31) em vez de um <select> nativo, que
// não combinava com o resto do visual.
function renderFolderPicker(item, excludeIds = new Set()) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-picker';
  const panelId = `fp-${item.id}`;
  wrapper.innerHTML = `
    <button type="button" class="folder-picker-trigger" popovertarget="${panelId}" popovertargetaction="toggle" title="Mover para pasta">
      <span class="current">${folderLabel(item.parentId)}</span>
      <span class="chevron">▾</span>
    </button>
    <div id="${panelId}" class="folder-picker-panel" popover="auto"></div>
  `;
  const trigger = wrapper.querySelector('.folder-picker-trigger');
  const panel = wrapper.querySelector('.folder-picker-panel');

  const folders = items.filter((b) => b.type === 'folder' && !excludeIds.has(b.id));
  const options = [{ id: '', title: 'Raiz' }, ...folders];
  panel.innerHTML = options
    .map((f) => `<button type="button" class="folder-option" data-value="${f.id}">${f.title}</button>`)
    .join('');

  panel.addEventListener('toggle', (e) => {
    if (e.newState === 'open') positionFolderPanel(trigger, panel);
  });
  panel.querySelectorAll('.folder-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const value = opt.dataset.value;
      panel.hidePopover();
      window.bookmarksAPI.move(item.id, value ? Number(value) : null).then(load);
    });
  });
  return wrapper;
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
        <span class="move-slot"></span>
        <button class="delete-btn" title="Remover">✕</button>
      </div>
      <span class="entry-url">${entry.url}</span>
    </div>
  `;
  const row = li.querySelector('.row');
  li.querySelector('.move-slot').replaceWith(renderFolderPicker(entry));

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
  li.querySelector('.delete-btn').addEventListener('click', () => {
    window.bookmarksAPI.remove(entry.id).then(load);
  });
  return li;
}

// Anima a lista de filhos de uma pasta entre recolhida e aberta usando a
// Web Animations API (funciona em qualquer Chromium, ao contrário de
// interpolate-size/calc-size(), que só chegaram no Chrome 129 — o
// Electron 31 empacota o Chromium 126). Os keyframes de altura são
// definidos explicitamente, então não dependem do estilo atual do
// elemento nem exigem forçar reflow.
function setFolderCollapsed(childList, toggleBtn, collapsed, { animate = true } = {}) {
  toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expandir pasta' : 'Recolher pasta');

  childList.getAnimations().forEach((a) => a.cancel());
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!animate || reduceMotion) {
    childList.style.height = '';
    childList.style.overflow = '';
    childList.hidden = collapsed;
    return;
  }

  const duration = 220;
  const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

  if (collapsed) {
    const startHeight = childList.scrollHeight;
    childList.style.overflow = 'hidden';
    const anim = childList.animate(
      [{ height: `${startHeight}px` }, { height: '0px' }],
      { duration, easing, fill: 'forwards' },
    );
    anim.onfinish = () => {
      childList.hidden = true;
      childList.style.height = '';
      childList.style.overflow = '';
    };
  } else {
    childList.hidden = false;
    const endHeight = childList.scrollHeight;
    childList.style.overflow = 'hidden';
    const anim = childList.animate(
      [{ height: '0px' }, { height: `${endHeight}px` }],
      { duration, easing, fill: 'forwards' },
    );
    anim.onfinish = () => {
      childList.style.height = '';
      childList.style.overflow = '';
    };
  }
}

// Anima a saída de uma linha da árvore (usado ao excluir uma pasta) antes
// de mexer nos dados de verdade — sem isso o item some de golpe assim que
// o backend responde, já que load() troca #tree inteiro pelo HTML novo.
function animateRowRemoval(li) {
  return new Promise((resolve) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resolve();
      return;
    }
    const startHeight = li.getBoundingClientRect().height;
    const startMargin = getComputedStyle(li).marginBottom;
    li.style.overflow = 'hidden';
    li.style.pointerEvents = 'none';
    const anim = li.animate(
      [
        { opacity: 1, height: `${startHeight}px`, marginBottom: startMargin },
        { opacity: 0, height: '0px', marginBottom: '0px' },
      ],
      { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
    anim.onfinish = resolve;
  });
}

function renderFolderNode(folder, depth = 0) {
  const li = document.createElement('li');
  const count = countDescendants(folder.id);
  const childrenId = `children-${folder.id}`;
  const isCollapsed = collapsedFolders.has(folder.id);
  li.innerHTML = `
    <div class="row folder-row" data-drop-folder-id="${folder.id}">
      <button
        type="button"
        class="folder-toggle"
        aria-expanded="${!isCollapsed}"
        aria-controls="${childrenId}"
        aria-label="${isCollapsed ? 'Expandir pasta' : 'Recolher pasta'}"
      ><span class="chevron-icon" aria-hidden="true">▸</span></button>
      <span class="folder-title" title="Renomear">${folder.title}</span>
      <span class="folder-count">${count}</span>
      <span class="move-slot"></span>
      <button class="add-sub-btn" title="Nova subpasta">+</button>
      <button class="delete-btn" title="Remover pasta">✕</button>
    </div>
  `;
  const row = li.querySelector('.row');
  row.style.setProperty('--depth', String(depth));
  const toggleBtn = li.querySelector('.folder-toggle');
  li.querySelector('.move-slot').replaceWith(renderFolderPicker(folder, folderAndDescendantIds(folder.id)));

  const childList = document.createElement('ul');
  childList.id = childrenId;
  renderLevel(childList, folder.id, depth + 1);
  li.appendChild(childList);
  setFolderCollapsed(childList, toggleBtn, isCollapsed, { animate: false });

  // Clicar em qualquer ponto vazio da linha (não só no botão ▸) recolhe ou
  // reabre a pasta — só os controles com ação própria (renomear, mover,
  // nova subpasta, remover) ficam de fora.
  row.addEventListener('click', (e) => {
    if (e.target.closest('.folder-title, .folder-picker, .add-sub-btn, .delete-btn')) return;
    const willCollapse = !collapsedFolders.has(folder.id);
    if (willCollapse) collapsedFolders.add(folder.id);
    else collapsedFolders.delete(folder.id);
    setFolderCollapsed(childList, toggleBtn, willCollapse);
  });
  li.querySelector('.folder-title').addEventListener('click', (e) => {
    editInline(e.target, folder.title, (title) => window.bookmarksAPI.rename(folder.id, title).then(load));
  });
  li.querySelector('.add-sub-btn').addEventListener('click', () => showNewFolderForm(row, folder.id));
  li.querySelector('.delete-btn').addEventListener('click', () => {
    animateRowRemoval(li).then(() => window.bookmarksAPI.remove(folder.id).then(load));
  });

  return li;
}

function renderLevel(container, parentId, depth = 0) {
  const children = items.filter((b) => (b.parentId ?? null) === parentId);
  children.filter((b) => b.type === 'folder').forEach((f) => container.appendChild(renderFolderNode(f, depth)));
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
