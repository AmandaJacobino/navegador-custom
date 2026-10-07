const REFRESH_MS = 2000;
const TWEEN_MS = 400;
const CATEGORY_COLORS = {
  tabs: 'var(--cat-tabs)',
  interface: 'var(--cat-interface)',
  gpu: 'var(--cat-gpu)',
  main: 'var(--cat-main)',
  services: 'var(--cat-services)',
};

const ramGauge = document.getElementById('ram-gauge');
const gaugeArc = document.getElementById('gauge-arc');
const gaugeNeedle = document.getElementById('gauge-needle');
const ramValue = document.getElementById('ram-value');
const ramNote = document.getElementById('ram-note');
const cpuMeter = document.getElementById('cpu-meter');
const cpuValue = document.getElementById('cpu-value');
const cpuNote = document.getElementById('cpu-note');
const stack = document.getElementById('stack');
const legend = document.getElementById('legend');
const tooltip = document.getElementById('stack-tooltip');
const tipLabel = document.getElementById('tip-label');
const tipValue = document.getElementById('tip-value');
const tabList = document.getElementById('tab-list');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let timer = null;

const decimal = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatPercent = (percent) => `${decimal(percent)}%`;

function formatMemory(kb) {
  const mb = kb / 1024;
  return mb >= 1024 ? `${decimal(mb / 1024)} GB` : `${decimal(mb)} MB`;
}

function statusOf(percent, warningAt, criticalAt) {
  if (percent >= criticalAt) return 'critical';
  if (percent >= warningAt) return 'warning';
  return 'good';
}

// Anima o número exibido do valor anterior até o novo; com movimento reduzido
// o valor troca direto.
function tweenText(el, to, format) {
  const from = el._value ?? 0;
  el._value = to;
  cancelAnimationFrame(el._frame);
  if (reducedMotion.matches || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / TWEEN_MS);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) el._frame = requestAnimationFrame(step);
  };
  el._frame = requestAnimationFrame(step);
}

function renderGauge({ totalKB, systemTotalKB }) {
  const percent = systemTotalKB ? Math.min(100, (totalKB / systemTotalKB) * 100) : 0;
  ramGauge.dataset.status = statusOf(percent, 50, 75);
  gaugeArc.style.strokeDashoffset = String(100 - percent);
  gaugeNeedle.style.rotate = `${percent * 1.8 - 90}deg`;
  tweenText(ramValue, totalKB, formatMemory);
  ramNote.textContent = `${Math.round(percent)}% da RAM · ${formatMemory(systemTotalKB)}`;
  ramGauge.setAttribute('aria-valuenow', percent.toFixed(1));
  ramGauge.setAttribute('aria-valuetext', `${formatMemory(totalKB)}, ${Math.round(percent)}% da RAM do sistema`);
}

function renderCpu({ cpuTotalPercent, cpuCores }) {
  cpuMeter.value = cpuTotalPercent;
  tweenText(cpuValue, cpuTotalPercent, formatPercent);
  cpuNote.textContent = `${cpuCores} ${cpuCores === 1 ? 'núcleo' : 'núcleos'}`;
}

function swatch(key) {
  const el = document.createElement('span');
  el.className = 'swatch';
  el.style.setProperty('--seg-color', CATEGORY_COLORS[key]);
  return el;
}

// Segmentos e itens da legenda são criados uma vez por categoria: a cor fica
// presa à categoria e a largura pode transicionar entre atualizações.
const segments = new Map();
const legendItems = new Map();

function segmentFor(category) {
  let seg = segments.get(category.key);
  if (seg) return seg;
  seg = document.createElement('div');
  seg.className = 'segment';
  seg.style.setProperty('--seg-color', CATEGORY_COLORS[category.key]);
  seg.addEventListener('mouseenter', () => { tooltip.hidden = false; });
  seg.addEventListener('mousemove', (e) => {
    tipLabel.textContent = seg.dataset.label;
    tipValue.textContent = seg.dataset.value;
    const x = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8);
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
  });
  seg.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  stack.append(seg);
  segments.set(category.key, seg);
  return seg;
}

function legendItemFor(category) {
  let item = legendItems.get(category.key);
  if (item) return item;
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = category.label;
  const percent = document.createElement('span');
  percent.className = 'legend-percent';
  li.append(swatch(category.key), label, percent);
  legend.append(li);
  item = { li, percent };
  legendItems.set(category.key, item);
  return item;
}

function renderBreakdown(categories, totalKB) {
  const visible = [];
  for (const category of categories) {
    const share = totalKB ? (category.memoryKB / totalKB) * 100 : 0;
    const seg = segmentFor(category);
    seg.hidden = category.memoryKB <= 0;
    seg.style.width = `${share}%`;
    seg.dataset.label = category.label;
    seg.dataset.value = `${formatMemory(category.memoryKB)} · ${formatPercent(share)}`;
    seg.classList.remove('first', 'last');
    if (!seg.hidden) visible.push(seg);
    legendItemFor(category).percent.textContent = formatPercent(share);
  }
  visible[0]?.classList.add('first');
  visible[visible.length - 1]?.classList.add('last');
}

// Reordena só quando a ordem muda: mover um nó reinsere o elemento e
// dispararia de novo a animação de entrada (@starting-style).
function syncOrder(list, nodes) {
  const current = [...list.children];
  if (current.length === nodes.length && current.every((n, i) => n === nodes[i])) return;
  list.append(...nodes);
}

function pruneMissing(map, keys) {
  for (const [key, node] of map) {
    if (!keys.has(key)) {
      node.li.remove();
      map.delete(key);
    }
  }
}

const tabRows = new Map();

function tabRowFor(id) {
  let row = tabRows.get(id);
  if (row) return row;
  const li = document.createElement('li');
  li.className = 'row';
  const main = document.createElement('div');
  main.className = 'row-main';
  const title = document.createElement('span');
  title.className = 'row-title';
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = 'Ativa';
  main.append(title, pill);
  const value = document.createElement('span');
  value.className = 'row-value';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'row-close';
  close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  close.addEventListener('click', async () => {
    close.disabled = true;
    await window.memoryAPI.closeTab(id);
    refresh();
  });
  const track = document.createElement('div');
  track.className = 'bar-track';
  const bar = document.createElement('div');
  bar.className = 'bar';
  track.append(bar);
  const note = document.createElement('span');
  note.className = 'row-note';
  note.textContent = 'processo compartilhado';
  li.append(main, value, close, track, note);
  row = { li, title, pill, value, close, bar, note };
  tabRows.set(id, row);
  return row;
}

function renderTabs(tabs) {
  const sorted = [...tabs].sort((a, b) => (b.memoryKB ?? -1) - (a.memoryKB ?? -1));
  const maxKB = Math.max(1, ...tabs.map((t) => t.memoryKB ?? 0));
  pruneMissing(tabRows, new Set(tabs.map((t) => t.id)));
  const nodes = sorted.map((tab) => {
    const row = tabRowFor(tab.id);
    // textContent e atributos (nunca innerHTML): título e URL vêm de páginas web.
    row.title.textContent = tab.title || tab.url;
    row.li.title = tab.title ? `${tab.title}\n${tab.url}` : tab.url;
    row.close.setAttribute('aria-label', `Fechar aba ${tab.title || tab.url}`);
    row.close.title = 'Fechar aba';
    row.li.classList.toggle('discarded', tab.discarded);
    row.pill.hidden = !tab.active;
    row.value.textContent = tab.memoryKB == null ? (tab.discarded ? 'Descartada' : '—') : formatMemory(tab.memoryKB);
    row.bar.style.width = `${tab.memoryKB == null ? 0 : (tab.memoryKB / maxKB) * 100}%`;
    row.note.hidden = !tab.sharedProcess;
    return row.li;
  });
  syncOrder(tabList, nodes);
}

async function refresh() {
  const usage = await window.memoryAPI.getUsage();
  renderGauge(usage);
  renderCpu(usage);
  renderBreakdown(usage.categories, usage.totalKB);
  renderTabs(usage.tabs);
}

function start() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

function stop() {
  clearInterval(timer);
  timer = null;
  tooltip.hidden = true;
}

window.memoryAPI.onVisibility((visible) => {
  if (visible) start();
  else stop();
});

start();
