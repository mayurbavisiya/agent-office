// Scene entry: connects to the local event server and keeps the floor in sync. Browser-only.
import type { ServerMessage } from '../shared/types.js';
import { Floor } from './floor.js';
import { tickTimers } from './characters.js';
import { animStats, planAnimations, runAnimations } from './animator.js';

const viewport = document.getElementById('floor') as HTMLElement;
const svg = document.getElementById('office') as unknown as SVGSVGElement;
const layer = document.getElementById('rooms') as unknown as SVGGElement;
const empty = document.getElementById('empty') as HTMLElement;
const conn = document.getElementById('conn') as HTMLElement;

const floor = new Floor(svg, layer, viewport);
const token = new URLSearchParams(location.search).get('token') ?? '';

function draw(): void {
  const n = floor.render();
  empty.hidden = n > 0;
}

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
    floor.render(msg.state);
    empty.hidden = Object.keys(msg.state.sessions).length > 0;
  };
  ws.onclose = () => {
    conn.hidden = false;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 5000);
  };
}

let pending = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}).observe(viewport);
setInterval(() => tickTimers(layer), 1000);

if (!token) empty.textContent = 'Missing token: open the URL printed by Agent Office.';
draw();
connect();

// hooks for later tasks (animator, click panel) and for debugging
(window as unknown as { agentOffice: unknown }).agentOffice = { floor, anim: animStats, planAnimations, runAnimations, svg };
