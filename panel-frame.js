// Comportamento comum dos painéis flutuantes: arrastar pelo cabeçalho, fechar
// pelo botão e redimensionar pelas bordas. Usa window.panelAPI, exposta pelo
// preload de cada painel. O processo principal é quem move a view.

const header = document.getElementById('panel-header');
const closeBtn = document.getElementById('panel-close');

closeBtn.addEventListener('click', () => window.panelAPI.close());
header.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('#panel-close')) return;
  window.panelAPI.startDrag();
});

// Soltar o botão em qualquer lugar do painel encerra arraste e redimensionamento.
document.addEventListener('mouseup', () => window.panelAPI.endDrag());

// Zona de redimensionamento de 6px em cada borda e canto. Só o cursor e o
// destaque da borda aparecem; nada é desenhado fora dela.
const RESIZE_ZONE = 6;
const EDGE_CURSORS = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

function edgeAt(x, y) {
  const top = y < RESIZE_ZONE;
  const bottom = y >= window.innerHeight - RESIZE_ZONE;
  const left = x < RESIZE_ZONE;
  const right = x >= window.innerWidth - RESIZE_ZONE;
  const edge = (top ? 'n' : '') + (bottom ? 's' : '') + (left ? 'w' : '') + (right ? 'e' : '');
  return edge || null;
}

// Destaca só os lados sob o cursor, via variáveis --hl-* definidas em panel-frame.css.
function highlightEdge(edge) {
  const style = document.documentElement.style;
  for (const side of ['n', 's', 'e', 'w']) {
    style.setProperty(`--hl-${side}`, edge && edge.includes(side) ? 'var(--accent)' : 'transparent');
  }
}

document.addEventListener('mousemove', (e) => {
  const edge = edgeAt(e.clientX, e.clientY);
  document.documentElement.style.cursor = edge ? EDGE_CURSORS[edge] : '';
  highlightEdge(edge);
});
document.addEventListener('mouseleave', () => {
  document.documentElement.style.cursor = '';
  highlightEdge(null);
});
document.addEventListener('mousedown', (e) => {
  const edge = edgeAt(e.clientX, e.clientY);
  if (!edge || e.button !== 0) return;
  window.panelAPI.startResize(edge);
});
