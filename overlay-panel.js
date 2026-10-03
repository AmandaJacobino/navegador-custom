const { BrowserView, screen } = require('electron');

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// Mantém value entre lo e hi. Se hi ficar menor que lo, prevalece lo.
function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

// Painel flutuante preso à janela principal: uma BrowserView de overlay
// empilhada sobre a página ativa. A BrowserView não é uma janela do SO, então
// arrastar e redimensionar são feitos aqui: o processo principal consulta a
// posição do cursor na tela periodicamente, o que funciona mesmo quando o
// cursor sai da área da própria view.
function createOverlayPanel({ getWindow, getUiHeight, preload, page, defaultSize, onKeyDown }) {
  let view = null;
  let open = false;
  let moved = false; // já foi arrastado ou redimensionado? então não recentraliza mais
  let drag = null;   // { cursor, bounds, interval }
  let resize = null; // { edge, cursor, bounds, interval }

  function ensureView() {
    if (view) return view;
    view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: true,
        sandbox: true,
      },
    });
    view.webContents.loadFile(page);
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.control && input.key.toLowerCase() === 'w') {
        event.preventDefault();
        close();
      } else if (onKeyDown) {
        onKeyDown(event, input, view);
      }
    });
    return view;
  }

  function layout() {
    const win = getWindow();
    if (!open || !win) return;
    const uiHeight = getUiHeight();
    const content = win.getContentBounds();
    if (!moved) {
      const { width, height } = defaultSize(content, uiHeight);
      const x = Math.max(0, Math.round((content.width - width) / 2));
      const y = uiHeight + Math.max(0, Math.round((content.height - uiHeight - height) / 2));
      view.setBounds({ x, y, width, height });
      return;
    }
    // Já foi movido pelo usuário: só reencaixa se uma redução de janela
    // deixou o painel total ou parcialmente pra fora.
    const current = view.getBounds();
    const x = clamp(current.x, 0, content.width - current.width);
    const y = clamp(current.y, uiHeight, content.height - current.height);
    if (x !== current.x || y !== current.y) view.setBounds({ ...current, x, y });
  }

  function openPanel() {
    const win = getWindow();
    if (!win) return;
    const v = ensureView();
    if (!open) {
      win.addBrowserView(v);
      open = true;
      layout();
    }
    v.webContents.focus();
  }

  function close() {
    const win = getWindow();
    if (!open || !win) return;
    stopInteraction();
    open = false;
    win.removeBrowserView(view);
  }

  function startDrag() {
    if (!open || drag || resize) return;
    moved = true;
    drag = {
      cursor: screen.getCursorScreenPoint(),
      bounds: view.getBounds(),
      interval: setInterval(tickDrag, 16),
    };
  }

  function tickDrag() {
    const win = getWindow();
    if (!drag || !win) return;
    const now = screen.getCursorScreenPoint();
    const dx = now.x - drag.cursor.x;
    const dy = now.y - drag.cursor.y;
    const { width, height } = drag.bounds;
    const content = win.getContentBounds();
    const uiHeight = getUiHeight();
    const x = clamp(drag.bounds.x + dx, 0, content.width - width);
    const y = clamp(drag.bounds.y + dy, uiHeight, content.height - height);
    view.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  }

  // Cada borda mexe só nos lados que ela toca (ex.: 'nw' move topo e
  // esquerda), respeitando tamanho mínimo e os limites da janela principal.
  function startResize(edge) {
    if (!open || drag || resize || !RESIZE_EDGES.includes(edge)) return;
    moved = true;
    resize = {
      edge,
      cursor: screen.getCursorScreenPoint(),
      bounds: view.getBounds(),
      interval: setInterval(tickResize, 16),
    };
  }

  function tickResize() {
    const win = getWindow();
    if (!resize || !win) return;
    const { edge, cursor, bounds } = resize;
    const now = screen.getCursorScreenPoint();
    const dx = now.x - cursor.x;
    const dy = now.y - cursor.y;
    const content = win.getContentBounds();
    const uiHeight = getUiHeight();
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;
    if (edge.includes('w')) left = clamp(bounds.x + dx, 0, right - MIN_WIDTH);
    if (edge.includes('e')) right = clamp(right + dx, left + MIN_WIDTH, content.width);
    if (edge.includes('n')) top = clamp(bounds.y + dy, uiHeight, bottom - MIN_HEIGHT);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + MIN_HEIGHT, content.height);
    view.setBounds({
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    });
  }

  // Para arraste e redimensionamento em andamento. Chamado também no mouseup
  // da toolbar, caso o botão seja solto fora do painel.
  function stopInteraction() {
    if (drag) {
      clearInterval(drag.interval);
      drag = null;
    }
    if (resize) {
      clearInterval(resize.interval);
      resize = null;
    }
  }

  // setBrowserView remove todas as views da janela; o painel precisa voltar
  // por cima da página recém-ativada.
  function reattach() {
    const win = getWindow();
    if (open && win) win.addBrowserView(view);
  }

  return {
    open: openPanel,
    close,
    isOpen: () => open,
    getView: () => view,
    layout,
    reattach,
    startDrag,
    startResize,
    stopInteraction,
  };
}

module.exports = { createOverlayPanel };
