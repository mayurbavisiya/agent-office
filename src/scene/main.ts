// Scene entry: connects to the local event server and keeps the floor in sync. Browser-only.
import type { ServerMessage } from '../shared/types.js';
import { Floor } from './floor.js';
import { tickTimers } from './characters.js';
import { InfoPanel } from './panel.js';
import { tokText } from './rooms.js';
import { animStats, planAnimations, ROOM_FADED_EVENT, runAnimations } from './animator.js';

const viewport = document.getElementById('floor') as HTMLElement;
const svg = document.getElementById('office') as unknown as SVGSVGElement;
const layer = document.getElementById('rooms') as unknown as SVGGElement;
const empty = document.getElementById('empty') as HTMLElement;
const conn = document.getElementById('conn') as HTMLElement;

const floor = new Floor(svg, layer, viewport);
const token = new URLSearchParams(location.search).get('token') ?? '';

const panelEl = document.getElementById('panel') as HTMLElement;
const panel = new InfoPanel(panelEl);

// ---- room zoom: a CSS transform on the floor's svg (the animator only touches inner wrappers) ----
const PANEL_W = 300 + 24; // card width + margins
const ZOOM_MARGIN = 8;
let zoomed: string | null = null;
let savedScroll = { left: 0, top: 0 };

function applyZoom(): void {
  const rect = zoomed ? floor.layoutOf(zoomed)?.rect : undefined;
  if (!zoomed || !rect) {
    if (zoomed) zoomed = null; // the room is gone
    svg.style.transform = '';
    layer.classList.remove('zoomed');
    viewport.classList.remove('zoomed');
    for (const r of layer.querySelectorAll('.zoom-target')) r.classList.remove('zoom-target');
    return;
  }
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const availW = panel.isOpen && vw >= 520 ? vw - PANEL_W : vw;
  const s = Math.max(0.1, Math.min((availW - 2 * ZOOM_MARGIN) / rect.w, (vh - 2 * ZOOM_MARGIN) / rect.h));
  const tx = (availW - rect.w * s) / 2 - rect.x * s;
  const ty = (vh - rect.h * s) / 2 - rect.y * s;
  svg.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
}

function setZoom(sessionId: string | null): void {
  if (sessionId === zoomed) return;
  if (sessionId && !floor.roomEl(sessionId)) return;
  if (!zoomed && sessionId) {
    savedScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.scrollTo(0, 0);
  }
  const wasZoomed = zoomed !== null;
  zoomed = sessionId;
  for (const r of layer.querySelectorAll('.zoom-target')) r.classList.remove('zoom-target');
  if (sessionId) {
    floor.roomEl(sessionId)?.classList.add('zoom-target');
    layer.classList.add('zoomed');
    viewport.classList.add('zoomed');
    applyZoom();
  } else {
    applyZoom();
    if (wasZoomed) viewport.scrollTo(savedScroll.left, savedScroll.top);
  }
}
panel.onChange = applyZoom;

function markSelected(): void {
  const sel = panel.selection;
  for (const c of layer.querySelectorAll<SVGGElement>('g.char')) {
    c.classList.toggle('sel', !!sel && c.dataset.sessionId === sel.sessionId && c.dataset.agentId === sel.agentId);
  }
}

/** Name-tag counters, from the latest state (called after renders and once a second). */
function refreshTags(): void {
  const { sessions } = floor.state;
  for (const c of layer.querySelectorAll<SVGGElement>('g.char')) {
    const sess = sessions[c.dataset.sessionId ?? ''];
    const stats = c.dataset.agentId === 'boss' ? sess?.boss.stats : sess?.agents[c.dataset.agentId ?? '']?.stats;
    const tok = c.querySelector('.tok');
    if (stats && tok) {
      const t = tokText(stats);
      if (tok.textContent !== t) tok.textContent = t;
    }
  }
}

function afterRender(): void {
  if (zoomed && !floor.roomEl(zoomed)) setZoom(null);
  else if (zoomed) applyZoom();
  if (zoomed) floor.roomEl(zoomed)?.classList.add('zoom-target');
  refreshTags();
  panel.refresh(floor.state);
  markSelected();
}

function draw(): void {
  const n = floor.render();
  empty.hidden = n > 0;
  afterRender();
}

viewport.addEventListener('click', (e) => {
  const t = e.target as Element;
  const room = t.closest<SVGGElement>('g.room');
  const char = t.closest<SVGGElement>('g.char');
  if (room && char && room.dataset.sessionId) {
    panel.open({ sessionId: room.dataset.sessionId, agentId: char.dataset.agentId ?? 'boss' }, floor.state);
    markSelected();
  } else if (room && room.dataset.sessionId) {
    setZoom(zoomed === room.dataset.sessionId ? null : room.dataset.sessionId);
  } else if (panel.isOpen) {
    panel.close();
    markSelected();
  } else {
    setZoom(null);
  }
});
panelEl.addEventListener('click', (e) => {
  if ((e.target as Element).closest('[data-action="close"]')) {
    panel.close();
    markSelected();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (panel.isOpen) panel.close();
  else setZoom(null);
  markSelected();
});

let delay = 500;
function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    delay = 500;
    conn.hidden = true;
  };
  ws.onmessage = (e) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(e.data)) as ServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || !msg.state || typeof msg.state.sessions !== 'object') return;
    // queue first (marks departing characters so this render keeps them), then render; queued
    // steps start on a microtask, after the render and before the next paint
    if (msg.type === 'events' && Array.isArray(msg.events)) runAnimations(planAnimations(msg.events, msg.state), svg);
    empty.hidden = floor.render(msg.state) > 0;
    afterRender();
  };
  ws.onclose = () => {
    conn.hidden = false;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 5000);
  };
}

// an ended room leaves the floor once its fade-out completes
svg.addEventListener(ROOM_FADED_EVENT, (e) => {
  const sid = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId;
  if (!sid) return;
  floor.hideEnded(sid);
  draw();
});

let pending = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}).observe(viewport);
setInterval(() => {
  tickTimers(layer);
  refreshTags();
  panel.refresh(floor.state);
}, 1000);

if (!token) empty.textContent = 'Missing token: open the URL printed by Agent Office.';
draw();
connect();

// hooks for later tasks (animator, click panel) and for debugging
(window as unknown as { agentOffice: unknown }).agentOffice = { floor, panel, zoom: setZoom, anim: animStats, planAnimations, runAnimations, svg };
