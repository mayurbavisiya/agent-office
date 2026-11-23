// One room per session: a scaled-down office (wall, window, clock, whiteboard, door, the boss's
// glass corner, desks) ported from the approved mockup. Browser-only.
import type { Agent, Session } from '../shared/types.js';
import { HEAD_TOP, roomLayout, SIGN_H, TAG_H, type Rect, type RoomLayout } from './layout.js';
import { agentLook, bossLook, formatTokens, looksFor, totalTokens, truncate } from './looks.js';
import { renderCharacter, renderDesk, setDeskScreen, svgEl, updateCharacter, type CharacterOpts } from './characters.js';

const layouts = new WeakMap<SVGGElement, RoomLayout>();
let clipSeq = 0;

/** The layout last used to draw a room group (for animators: seats, boss, door, scale). */
export function layoutOf(room: SVGGElement): RoomLayout | undefined {
  return layouts.get(room);
}

function html(g: Element, s: string): void {
  g.insertAdjacentHTML('beforeend', s);
}

const tokText = (n: number) => `⚡ ${formatTokens(n)} tok`;

/** Builds a room group for a session and draws it into rect (floor coordinates). */
export function renderRoom(session: Session, rect: Rect): SVGGElement {
  const g = svgEl('g', { class: 'room' });
  const clipId = `room-clip-${++clipSeq}`;
  const clip = svgEl('clipPath', { id: clipId }, g);
  svgEl('rect', { rx: 10 }, clip);
  const inner = svgEl('g', { class: 'room-inner', 'clip-path': `url(#${clipId})` }, g);
  svgEl('g', { class: 'bg' }, inner);
  svgEl('g', { class: 'board' }, inner);
  svgEl('g', { class: 'desks' }, inner);
  svgEl('g', { class: 'people' }, inner);
  svgEl('g', { class: 'anim-fx' }, inner); // animator overlays: sparkle, paper, bubbles, confetti
  svgEl('rect', { class: 'dim', x: 0, y: 0, fill: '#0f172a' }, inner);
  const sign = svgEl('g', { class: 'sign' }, inner);
  svgEl('rect', { x: 8, y: 6, height: SIGN_H, rx: 5, fill: '#1e293b' }, sign);
  const text = svgEl('text', { x: 16, y: 6 + 15, 'font-size': 11.5, fill: '#e2e8f0' }, sign);
  svgEl('tspan', { class: 'label', 'font-weight': 700, fill: '#facc15' }, text);
  svgEl('tspan', { class: 'sub', fill: '#cbd5e1' }, text);
  svgEl('tspan', { class: 'branch', fill: '#93c5fd' }, text);
  svgEl('tspan', { class: 'count', fill: '#94a3b8' }, text);
  updateRoom(g, session, rect);
  return g;
}

/** Static background for a room size; rebuilt only when the size changes. */
function drawBackground(bg: SVGGElement, l: RoomLayout): void {
  const { w, h } = l.rect;
  const { wallH, bossW, doorRect: d } = l;
  const parts: string[] = [];
  parts.push(`<rect width="${w}" height="${wallH}" fill="#f4ecdf"/>`);
  parts.push(`<rect y="${wallH - 6}" width="${w}" height="8" fill="#e2d4bd"/>`);
  parts.push(`<rect y="${wallH + 2}" width="${w}" height="${h - wallH - 2}" fill="url(#planks)"/>`);

  // decorations that fit between the boss's glass wall and the door
  let x = bossW + 34; // leaves the plant its spot by the glass wall
  const free = () => d.x - 10 - x;
  const top = SIGN_H + 14;
  const avail = wallH - top - 12;
  if (avail >= 22 && free() >= 90) {
    const wh = Math.min(avail, 80);
    const ww = Math.round(Math.min(free() * 0.4, wh * 1.7, 130));
    if (ww >= 40) {
      parts.push(`<g transform="translate(${x},${top})"><svg width="${ww}" height="${wh}" viewBox="0 0 190 110" preserveAspectRatio="none" overflow="hidden">
        <rect width="190" height="110" rx="6" fill="#8ec5ff"/>
        <g class="cloud"><ellipse cx="40" cy="35" rx="26" ry="11" fill="#fff"/><ellipse cx="58" cy="30" rx="16" ry="10" fill="#fff"/></g>
        <circle cx="160" cy="28" r="12" fill="#ffd166"/>
        <path d="M0 85 l40-30 30 20 40-35 50 40 30-15v45H0z" fill="#6bbf7a"/>
        <rect width="190" height="110" rx="6" fill="none" stroke="#fff" stroke-width="7"/>
        <path d="M95 0v110M0 55h190" stroke="#fff" stroke-width="4"/></svg></g>`);
      x += ww + 16;
    }
  }
  const cr = Math.round(Math.min(18, avail / 2.4));
  if (cr >= 10 && free() >= cr * 2 + 8) {
    parts.push(`<g transform="translate(${x + cr},${top + cr + 2})"><circle r="${cr}" fill="#fff" stroke="#555" stroke-width="2.5"/>
      <rect class="hand2" x="-1.5" y="${-cr * 0.58}" width="3" height="${cr * 0.58}" fill="#333"/>
      <rect class="hand" x="-1" y="${-cr * 0.8}" width="2" height="${cr * 0.8}" fill="#e11d48"/><circle r="2" fill="#333"/></g>`);
    x += cr * 2 + 16;
  }
  // whiteboard goes at x (contents drawn per update in .board)

  // door, on the right of the back wall
  parts.push(`<g transform="translate(${d.x},${d.y})"><rect width="${d.w}" height="${d.h}" fill="#5b4636"/>
    <rect class="doorL" x="2.5" y="2.5" width="${d.w - 5}" height="${d.h - 2.5}" fill="#a47551"/>
    <circle cx="${d.w - 9}" cy="${d.h * 0.53}" r="2.5" fill="#facc15"/></g>`);

  // water cooler beside the door, when there is room
  if (d.x - x > 40 && wallH > 80) {
    const s = Math.min(1, wallH / 140);
    parts.push(`<g transform="translate(${d.x - 34 * s},${wallH - 60 * s}) scale(${s})"><rect x="0" y="20" width="26" height="40" rx="3" fill="#e5e7eb"/>
      <g class="cooler"><rect x="3" y="-6" width="20" height="28" rx="8" fill="#93c5fd" opacity=".85"/></g></g>`);
  }

  // the boss's glass office
  parts.push(`<rect width="${bossW}" height="${h}" fill="#dbeafe" opacity=".35"/>`);
  parts.push(`<rect x="${bossW - 2}" width="4" height="${h}" fill="#94a3b8" opacity=".6"/>`);
  if (wallH - top >= 44 && bossW >= 110) {
    const s = Math.min(1, (wallH - top - 6) / 50);
    parts.push(`<g transform="translate(14,${top}) scale(${s})"><rect width="70" height="50" fill="#fbbf24" opacity=".9" rx="3"/>
      <text x="35" y="22" font-size="9" text-anchor="middle" fill="#7c2d12">TEAM OF</text><text x="35" y="34" font-size="9" text-anchor="middle" fill="#7c2d12" font-weight="700">THE MONTH</text></g>`);
  }
  // plant just outside the glass wall
  const ps = Math.min(0.8, wallH / 140);
  parts.push(`<g transform="translate(${bossW + 16},${wallH - 28 * ps}) scale(${ps})">
    <rect x="-12" y="10" width="24" height="22" rx="3" fill="#b45309"/>
    <ellipse cx="-8" cy="2" rx="8" ry="16" fill="#22c55e" transform="rotate(-25)"/>
    <ellipse cx="8" cy="2" rx="8" ry="16" fill="#16a34a" transform="rotate(25)"/>
    <ellipse cx="0" cy="-4" rx="7" ry="17" fill="#4ade80"/></g>`);

  bg.replaceChildren();
  html(bg, parts.join(''));
  bg.dataset.wbX = String(x);
}

/** Whiteboard listing up to 4 agent tasks, when the wall has space for it. */
function drawBoard(board: SVGGElement, bg: SVGGElement, l: RoomLayout, agents: Agent[]): void {
  const x = Number(bg.dataset.wbX);
  const top = SIGN_H + 14;
  const ww = Math.min(170, l.doorRect.x - 50 - x);
  // keep the board clear of the top row's name tags
  const tagTop = Math.min(Infinity, ...Object.values(l.seats).map((p) => p.y - HEAD_TOP * l.scale - TAG_H - 4));
  const wh = Math.min(l.wallH - 12, tagTop, top + 110) - top;
  board.replaceChildren();
  if (!agents.length || ww < 100 || wh < 46) return;
  const g = svgEl('g', { transform: `translate(${x},${top})` }, board);
  svgEl('rect', { width: ww, height: wh, rx: 4, fill: '#fff', stroke: '#9ca3af', 'stroke-width': 3 }, g);
  const title = svgEl('text', { x: 8, y: 15, 'font-size': 9.5, 'font-weight': 700, fill: '#2563eb' }, g);
  title.textContent = "TODAY'S TASKS";
  const rows = Math.min(4, Math.floor((wh - 20) / 13));
  const chars = Math.floor((ww - 20) / 4.7);
  agents.slice(0, rows).forEach((a, i) => {
    const look = agentLook(a.status);
    const t = svgEl('text', { x: 8, y: 30 + i * 13, 'font-size': 8.5, fill: look.fx === 'stuck' ? '#dc2626' : '#555' }, g);
    t.textContent = `${a.status === 'handing_off' ? '✓' : '◻'} ${truncate(a.task ?? a.name ?? a.type, chars)}`;
  });
}

function placeDesk(desks: SVGGElement, key: string, x: number, y: number, s: number, screen: 'code' | 'err', sessionId: string): SVGGElement {
  let d = desks.querySelector<SVGGElement>(`:scope > [data-desk-for="${CSS.escape(key)}"]`);
  if (!d) {
    d = renderDesk(screen);
    d.dataset.deskFor = key;
    d.dataset.sessionId = sessionId;
    desks.appendChild(d);
  }
  setDeskScreen(d, screen);
  d.setAttribute('transform', `translate(${Math.round(x + 26 * s)},${Math.round(y + 20 * s)}) scale(${s})`);
  return d;
}

function placeCharacter(people: SVGGElement, opts: CharacterOpts, x: number, y: number): SVGGElement {
  let c = people.querySelector<SVGGElement>(`:scope > [data-agent-id="${CSS.escape(opts.id)}"]`);
  if (c) updateCharacter(c, opts);
  else {
    c = renderCharacter(opts);
    people.appendChild(c);
  }
  c.setAttribute('transform', `translate(${x},${y})`);
  c.dataset.x = String(x);
  c.dataset.y = String(y);
  return c;
}

/**
 * Diffs a room group against the session: characters and desks are keyed by id and updated
 * in place (so their CSS animations keep running); ones no longer in state are removed, except
 * characters marked data-departing while their exit animation runs.
 */
export function updateRoom(g: SVGGElement, session: Session, rect: Rect): RoomLayout {
  // previous slots keep every agent at its desk across snapshots (sticky seats)
  const l = roomLayout(session, rect, layouts.get(g)?.slots);
  layouts.set(g, l);
  const sid = session.id;
  g.dataset.sessionId = sid;
  g.setAttribute('transform', `translate(${rect.x},${rect.y})`);

  const sizeKey = `${rect.w}x${rect.h}`;
  const inner = g.querySelector<SVGGElement>(':scope > .room-inner')!;
  const bg = inner.querySelector<SVGGElement>(':scope > .bg')!;
  if (g.dataset.size !== sizeKey) {
    g.dataset.size = sizeKey;
    const cr = g.querySelector('clipPath > rect')!;
    cr.setAttribute('width', String(rect.w));
    cr.setAttribute('height', String(rect.h));
    const dim = inner.querySelector(':scope > .dim')!;
    dim.setAttribute('width', String(rect.w));
    dim.setAttribute('height', String(rect.h));
    drawBackground(bg, l);
  }

  // sign: label · subLabel ⎇ branch, cut to the room width
  const count = l.order.length ? `  · ${l.order.length} agent${l.order.length === 1 ? '' : 's'}` : '';
  const maxChars = Math.max(10, Math.floor((rect.w - 40) / 6.6) - count.length);
  let label = session.label;
  let sub = session.subLabel ? ` · ${session.subLabel}` : '';
  let branch = session.branch ? `  ⎇ ${session.branch}` : '';
  if (label.length + sub.length + branch.length > maxChars) {
    label = truncate(label, Math.max(8, Math.floor(maxChars * 0.45)));
    const rest = maxChars - label.length;
    sub = sub ? truncate(sub, Math.max(6, Math.floor(rest * 0.45))) : '';
    branch = branch ? truncate(branch, Math.max(6, rest - sub.length)) : '';
  }
  const sign = inner.querySelector<SVGGElement>(':scope > .sign')!;
  const setT = (cls: string, v: string) => {
    const t = sign.querySelector(`.${cls}`)!;
    if (t.textContent !== v) t.textContent = v;
  };
  setT('label', label);
  setT('sub', sub);
  setT('branch', branch);
  setT('count', count);
  const signChars = label.length + sub.length + branch.length + count.length;
  sign.querySelector('rect')!.setAttribute('width', String(Math.min(rect.w - 16, signChars * 6.4 + 18)));

  const boss = bossLook(session.boss.status);
  const ended = session.status === 'ended';
  g.classList.toggle('room--dim', boss.dim || ended);
  g.classList.toggle('room--crowded', l.crowded);
  g.dataset.bossStatus = session.boss.status;

  const visible = l.order.map((id) => session.agents[id]).filter((a): a is Agent => !!a);
  drawBoard(inner.querySelector<SVGGElement>(':scope > .board')!, bg, l, visible);

  const desks = inner.querySelector<SVGGElement>(':scope > .desks')!;
  const people = inner.querySelector<SVGGElement>(':scope > .people')!;
  const keep = new Set<string>(['boss']);

  // boss
  const main = looksFor('main');
  placeDesk(desks, 'boss', l.boss.x, l.boss.y, l.bossScale, 'code', sid);
  placeCharacter(
    people,
    {
      id: 'boss',
      sessionId: sid,
      color: main.color,
      accessory: main.accessory,
      mood: boss.mood,
      pose: boss.pose,
      fx: boss.fx,
      name: 'Main agent',
      task: session.boss.status.replace(/_/g, ' '),
      tokens: tokText(totalTokens(session.boss.stats)),
      scale: l.bossScale,
    },
    l.boss.x,
    l.boss.y,
  ).classList.add('boss');

  // agents
  for (const a of visible) {
    const seat = l.seats[a.id];
    keep.add(a.id);
    const look = looksFor(a.type);
    const st = agentLook(a.status);
    placeDesk(desks, a.id, seat.x, seat.y, l.scale, st.screen, sid);
    const c = placeCharacter(
      people,
      {
        id: a.id,
        sessionId: sid,
        color: look.color,
        accessory: look.accessory,
        mood: st.mood,
        pose: st.pose,
        fx: st.fx,
        since: a.stats.lastActivity,
        name: a.name ?? a.type,
        task: truncate(a.task, l.taskChars),
        tokens: tokText(totalTokens(a.stats)),
        scale: l.scale,
      },
      seat.x,
      seat.y,
    );
    c.dataset.status = a.status;
    c.dataset.depth = String(seat.depth);
    if (a.parentId) c.dataset.parentId = a.parentId;
    else delete c.dataset.parentId;
  }

  // a departing character (marked by the animator) outlives its seat until its handoff + exit
  // finish; the animator removes it then. Pruned agents are removed regardless.
  for (const el of Array.from(people.children) as SVGGElement[]) {
    const id = el.dataset.agentId ?? '';
    if (keep.has(id)) continue;
    if (el.dataset.departing && session.agents[id]) continue;
    el.remove();
  }
  for (const el of Array.from(desks.children) as SVGGElement[]) if (!keep.has(el.dataset.deskFor ?? '')) el.remove();
  return l;
}
