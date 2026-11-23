// SVG builders for characters and desks, ported from the approved mockup (office-v2.html).
// Browser-only. Text from state is always set via textContent, never interpolated into markup.
import type { Accessory, Fx, Mood, Pose, Screen } from './looks.js';
import { formatTimer } from './looks.js';
import { HEAD_TOP } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
/** Appends trusted, static markup (numbers and hex colors only). */
function html(g: Element, s: string): void {
  g.insertAdjacentHTML('beforeend', s);
}
const r1 = (n: number) => Math.round(n * 10) / 10;

export type CharacterOpts = {
  id: string;
  sessionId?: string;
  color: string;
  accessory: Accessory;
  mood: Mood;
  pose: Pose;
  name: string;
  /** token counter text, e.g. "⚡ 12.3k tok" */
  tokens: string;
  task?: string;
  /** body scale (name tag text stays at a fixed pixel size) */
  scale?: number;
  fx?: Fx;
  /** epoch ms the quiet timer counts from (fx 'stuck') */
  since?: number;
};

const ACCESSORY: Record<Accessory, string> = {
  crown: '<path d="M-12 -50 l4 -12 8 8 8 -8 4 12z" fill="#facc15" stroke="#ca8a04"/><path d="M0 -12 l-4 8 4 6 4 -6z" fill="#dc2626"/>',
  headphones: '<path d="M-20 -36 q20 -26 40 0" stroke="#111" stroke-width="3" fill="none"/><rect x="-24" y="-38" width="7" height="12" rx="3" fill="#111"/><rect x="17" y="-38" width="7" height="12" rx="3" fill="#111"/>',
  glasses: '<circle cx="-7" cy="-33" r="6" fill="none" stroke="#111" stroke-width="2"/><circle cx="7" cy="-33" r="6" fill="none" stroke="#111" stroke-width="2"/><path d="M-1 -33h2" stroke="#111" stroke-width="2"/>',
  hat: '<path d="M-14 -46 q14 -14 28 0" fill="#fde047"/>',
  notepad: '<g transform="translate(-9,-11) rotate(-8)"><rect x="-6" y="-7" width="12" height="14" rx="1.5" fill="#fef3c7" stroke="#a16207"/><rect x="-4" y="-9" width="8" height="3" rx="1" fill="#a16207"/><path d="M-3.5 -2.5h7M-3.5 0.5h7M-3.5 3.5h4.5" stroke="#a16207" stroke-width="1"/></g><path d="M14 -46 l6 -10" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/>',
  none: '',
};

function face(mood: Mood): string {
  if (mood === 'sleepy')
    return '<path d="M-10 -33 q3 3 6 0 M4 -33 q3 3 6 0" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="-22" rx="2.5" ry="2" fill="#1f2937"/>';
  const eyes = '<g class="blink"><circle cx="-7" cy="-33" r="3" fill="#1f2937"/><circle cx="7" cy="-33" r="3" fill="#1f2937"/></g><circle cx="-6" cy="-34" r="1" fill="#fff"/><circle cx="8" cy="-34" r="1" fill="#fff"/>';
  const mouth =
    mood === 'happy'
      ? '<path d="M-6 -24 q6 6 12 0" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/>'
      : mood === 'worried'
        ? '<path d="M-5 -21 q5 -5 10 0" stroke="#1f2937" stroke-width="2" fill="none"/><path d="M-12 -42 l8 3 M12 -42 l-8 3" stroke="#1f2937" stroke-width="2"/>'
        : '<path d="M-4 -23 h8" stroke="#1f2937" stroke-width="2" stroke-linecap="round"/>';
  return eyes + mouth;
}

function arm(c: string, x1: number, y1: number, x2: number, y2: number, cls = ''): string {
  return `<line${cls ? ` class="${cls}"` : ''} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
}

function arms(pose: Pose, c: string): string {
  switch (pose) {
    case 'type':
      return arm(c, -17, -20, -24, -6, 'typeL') + arm(c, 17, -20, 24, -6, 'typeR');
    case 'scratch':
      return arm(c, -17, -20, -24, -6) + arm(c, 18, -26, 20, -50, 'scratch');
    case 'wave':
      return arm(c, -17, -20, -24, -6) + arm(c, 18, -26, 26, -46, 'scratch');
    case 'carry':
      return (
        arm(c, -17, -20, -28, -16) +
        arm(c, 17, -20, 24, -8) +
        '<g class="paper"><rect x="-44" y="-30" width="16" height="20" rx="2" fill="#fff" stroke="#999"/><path d="M-41 -25h10M-41 -21h10M-41 -17h7" stroke="#bbb"/></g>'
      );
    case 'raise_hand':
      return arm(c, -17, -20, -24, -6) + arm(c, 17, -28, 22, -62) + `<circle cx="22" cy="-64" r="4.5" fill="${c}"/>`;
    case 'walk':
    case 'stand':
    default:
      return arm(c, -18, -20, -23, -4) + arm(c, 18, -20, 23, -4);
  }
}

function legs(pose: Pose): string {
  if (pose === 'walk' || pose === 'carry')
    return '<g><line class="legA" x1="-7" y1="-2" x2="-8" y2="14" stroke="#333" stroke-width="5" stroke-linecap="round"/><line class="legB" x1="7" y1="-2" x2="8" y2="14" stroke="#333" stroke-width="5" stroke-linecap="round"/></g>';
  if (pose === 'stand' || pose === 'wave')
    return '<g><line x1="-7" y1="-2" x2="-8" y2="14" stroke="#333" stroke-width="5" stroke-linecap="round"/><line x1="7" y1="-2" x2="8" y2="14" stroke="#333" stroke-width="5" stroke-linecap="round"/></g>';
  return '';
}

function figureMarkup(o: CharacterOpts): string {
  const c = o.color;
  return `${legs(o.pose)}<g class="bob">
    <ellipse class="body" cx="0" cy="-26" rx="21" ry="25" fill="${c}"/>
    <ellipse cx="0" cy="-18" rx="13" ry="11" fill="#fff" opacity=".18"/>
    ${face(o.mood)}
    <circle cx="-13" cy="-25" r="3" fill="#fda4af" opacity=".7"/><circle cx="13" cy="-25" r="3" fill="#fda4af" opacity=".7"/>
    ${ACCESSORY[o.accessory] ?? ''}
  </g>${arms(o.pose, c)}`;
}

/** Status overlays in pixel units around a figure of body scale s. */
function fxMarkup(fx: Fx, s: number): string {
  const top = -HEAD_TOP * s;
  switch (fx) {
    case 'stuck':
      return `<text class="sweat" x="${r1(18 * s)}" y="${r1(top + 6)}" font-size="12">💧</text>
        <g transform="translate(${r1(-30 * s - 6)},${r1(top + 4)})"><g class="bubbleq"><circle r="8" fill="#fff" stroke="#dc2626" stroke-width="1.5"/><text y="4" font-size="11" font-weight="800" fill="#dc2626" text-anchor="middle">?</text></g></g>
        <g transform="translate(0,${r1(4 * s + 2)})"><rect x="-24" y="0" width="48" height="14" rx="7" fill="#dc2626"/><text class="timer" y="10.5" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">⏱ 0:00</text></g>`;
    case 'alert':
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 2)})"><g class="bubbleq"><circle r="9" fill="#fff" stroke="#f59e0b" stroke-width="2"/><text y="4.5" font-size="13" font-weight="900" fill="#d97706" text-anchor="middle">!</text></g></g>`;
    case 'zzz':
      return `<g transform="translate(${r1(16 * s)},${r1(top + 4)})" fill="#64748b" font-weight="700">
        <text class="zz" font-size="10">z</text><text class="zz" style="animation-delay:.8s" x="5" y="-5" font-size="12">z</text><text class="zz" style="animation-delay:1.6s" x="10" y="-11" font-size="14">z</text></g>`;
    case 'tap':
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 4)})"><g class="bubbleq"><rect x="-11" y="-8" width="22" height="15" rx="7" fill="#fff" stroke="#94a3b8"/><text y="3.5" font-size="10" font-weight="800" fill="#475569" text-anchor="middle">…</text></g></g>`;
    default:
      return '';
  }
}

/**
 * Builds a character group; see updateCharacter for the attributes it carries.
 * Structure: g.char (positioned by its caller via the transform attribute) > g.anim (owned by the
 * animator: Web Animations offsets/opacity only) > .fig, .fx, .tag. The two transforms compose,
 * so a snapshot re-placing g.char never clobbers a walk in progress.
 */
export function renderCharacter(opts: CharacterOpts): SVGGElement {
  const g = svgEl('g', { class: 'char' });
  const anim = svgEl('g', { class: 'anim' }, g);
  const fig = svgEl('g', { class: 'fig' }, anim);
  fig.dataset.sig = '';
  svgEl('g', { class: 'fx' }, anim);
  const tag = svgEl('g', { class: 'tag' }, anim);
  svgEl('rect', { class: 'pill', height: 15, rx: 7.5, fill: '#fff', 'stroke-width': 1.5 }, tag);
  svgEl('text', { class: 'name', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle', fill: '#111' }, tag);
  svgEl('text', { class: 'task', 'font-size': 8, 'text-anchor': 'middle', fill: '#334155' }, tag);
  svgEl('text', { class: 'tok', 'font-size': 8, 'font-weight': 600, 'text-anchor': 'middle', fill: '#334155' }, tag);
  updateCharacter(g, opts);
  return g;
}

const lastOpts = new WeakMap<SVGGElement, CharacterOpts>();

/**
 * Overrides the state-driven pose while an animation runs (e.g. 'walk' while walking in);
 * null restores the pose from state. Survives snapshot updates until cleared.
 */
export function setAnimPose(g: SVGGElement, pose: Pose | null): void {
  if (pose) g.dataset.animPose = pose;
  else delete g.dataset.animPose;
  const o = lastOpts.get(g);
  if (o) updateCharacter(g, o);
}

/**
 * Updates a character in place. The figure (and its CSS animations) is only rebuilt when
 * pose/mood/look/scale change; overlays only when the status overlay changes.
 * Position is not touched here: the caller sets the group's transform.
 */
export function updateCharacter(g: SVGGElement, opts: CharacterOpts): void {
  lastOpts.set(g, opts);
  const o: CharacterOpts = g.dataset.animPose ? { ...opts, pose: g.dataset.animPose as Pose } : opts;
  const s = o.scale ?? 1;
  const fx = o.fx ?? 'none';
  g.dataset.agentId = o.id;
  if (o.sessionId !== undefined) g.dataset.sessionId = o.sessionId;
  g.dataset.pose = o.pose;
  g.dataset.mood = o.mood;
  g.classList.toggle('tapping', fx === 'tap');

  const fig = g.querySelector<SVGGElement>(':scope > .anim > .fig')!;
  const sig = [o.pose, o.mood, o.accessory, o.color, s].join('|');
  if (fig.dataset.sig !== sig) {
    fig.dataset.sig = sig;
    fig.setAttribute('transform', `scale(${s})`);
    fig.replaceChildren();
    html(fig, figureMarkup(o));
  }

  const fxg = g.querySelector<SVGGElement>(':scope > .anim > .fx')!;
  const fxSig = `${fx}|${s}`;
  if (fxg.dataset.sig !== fxSig) {
    fxg.dataset.sig = fxSig;
    fxg.replaceChildren();
    html(fxg, fxMarkup(fx, s));
  }
  const timer = fxg.querySelector<SVGTextElement>('.timer');
  if (timer) {
    timer.dataset.since = String(o.since ?? Date.now());
    paintTimer(timer, Date.now());
  }

  // name tag stack, fixed pixel size, sitting above the head
  const a = -HEAD_TOP * s;
  const tag = g.querySelector<SVGGElement>(':scope > .anim > .tag')!;
  const pill = tag.querySelector<SVGRectElement>('.pill')!;
  const name = tag.querySelector<SVGTextElement>('.name')!;
  const task = tag.querySelector<SVGTextElement>('.task')!;
  const tok = tag.querySelector<SVGTextElement>('.tok')!;
  if (name.textContent !== o.name) name.textContent = o.name;
  const w = Math.max(30, o.name.length * 6 + 14);
  pill.setAttribute('x', String(-w / 2));
  pill.setAttribute('width', String(w));
  pill.setAttribute('y', String(r1(a - 36)));
  pill.setAttribute('stroke', o.color);
  name.setAttribute('y', String(r1(a - 25)));
  const t = o.task ?? '';
  if (task.textContent !== t) task.textContent = t;
  task.setAttribute('y', String(r1(a - 13)));
  if (tok.textContent !== o.tokens) tok.textContent = o.tokens;
  tok.setAttribute('y', String(r1(a - 4)));
}

function paintTimer(t: SVGTextElement, now: number): void {
  const since = Number(t.dataset.since);
  const txt = '⏱ ' + formatTimer(now - (Number.isFinite(since) ? since : now));
  if (t.textContent !== txt) t.textContent = txt;
}

/** Refreshes every quiet timer under root (call once a second). */
export function tickTimers(root: ParentNode, now = Date.now()): void {
  root.querySelectorAll<SVGTextElement>('.timer').forEach((t) => paintTimer(t, now));
}

/** Monitor lines, ported from the mockup's desk(). */
function screenMarkup(screen: Screen): string {
  const err = screen === 'err';
  const lines = Array.from({ length: 10 }, (_, i) => {
    const fill = err ? '#f87171' : ['#7ee787', '#79c0ff', '#d2a8ff'][i % 3];
    return `<rect x="${-19 + (i % 3) * 3}" y="${-58 + i * 6}" width="${12 + ((i * 7) % 20)}" height="2.5" rx="1" fill="${fill}"/>`;
  }).join('');
  return `<rect x="-22" y="-62" width="44" height="28" fill="${err ? '#3f0d12' : '#0b1220'}"/><g class="scroll">${lines}</g>`;
}

/** A desk with a monitor, in body units (place it at seat + (26, 20) * scale, scaled). */
export function renderDesk(screen: Screen = 'code', mug = true): SVGGElement {
  const g = svgEl('g', { class: 'desk' });
  html(
    g,
    `<g transform="translate(26,0)"><rect x="-26" y="-64" width="52" height="34" rx="3" fill="#1f2937"/>
    <g class="screen" clip-path="url(#scr1)"></g>
    <rect x="-4" y="-30" width="8" height="8" fill="#374151"/></g>
    <rect x="-58" y="-22" width="116" height="10" rx="3" fill="#8b5e34"/>
    <rect x="-54" y="-12" width="6" height="28" fill="#6b4423"/><rect x="48" y="-12" width="6" height="28" fill="#6b4423"/>
    <rect x="8" y="-26" width="28" height="5" rx="1.5" fill="#d1d5db"/>` +
      (mug
        ? '<g transform="translate(-44,-28)"><rect x="-5" y="0" width="10" height="9" rx="2" fill="#fff" stroke="#bbb"/><path class="steam" d="M-2 -2 q2 -4 0 -8 M2 -2 q2 -4 0 -8" stroke="#bbb" fill="none"/></g>'
        : ''),
  );
  setDeskScreen(g, screen);
  return g;
}

export function setDeskScreen(desk: SVGGElement, screen: Screen): void {
  if (desk.dataset.screen === screen) return;
  desk.dataset.screen = screen;
  const scr = desk.querySelector('.screen')!;
  scr.replaceChildren();
  html(scr, screenMarkup(screen));
}
