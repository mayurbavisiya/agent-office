// SVG builders for characters, chairs and desks. The office-person rig, its furniture and keyframes
// are ported from the approved human-characters mockup (option A, "Office people").
// Browser-only, except the pure markup helpers (personMarkup, stateClasses) which are tested under node.
// Text from state is always set via textContent, never interpolated into markup.
import { writeTok } from './tokTicker.js';
import type { Fx, HumanLook, Mood, Pose, PoseClass, Screen } from './looks.js';
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
  /** name tag outline colour */
  color: string;
  /** skin, hair, shirt, trousers (and the boss's tie) */
  human: HumanLook;
  /** status pose of a present character (see looks.poseClass) */
  pose: PoseClass;
  /** 'sleepy' closes the eye */
  mood: Mood;
  name: string;
  /** token counter text, e.g. "⚡ 12.3k tok" */
  tokens: string;
  task?: string;
  /** body scale (name tag text stays at a fixed pixel size) */
  scale?: number;
  fx?: Fx;
  /** epoch ms the quiet timer counts from (fx 'stuck') */
  since?: number;
  /** head-and-shoulders only (compact strip): never seated, so the rig stays upright */
  bust?: boolean;
};

/**
 * Rig proportions in body units (feet at y 0, facing +x). Standing, the head top is at
 * -(leg + torso + 2 * head - 1) = -HEAD_TOP. Seated, the body drops by half a leg (--L).
 */
export const RIG = { head: 8, torso: 21, leg: 22, arm: 19, w: 14, rx: 3 } as const;
const HALF_LEG = RIG.leg / 2;

/** State classes on g.char (toggled by the animator) and the pose classes they combine with. */
export const STATE_CLASSES = ['walking', 'sitting', 'carrying', 'giving', 'cheer'] as const;
export const POSE_CLASSES: PoseClass[] = ['pose-type', 'pose-slump', 'pose-wave', 'pose-lean', 'pose-idle'];

/**
 * Classes for g.char: a present character sits with its status pose (the boss stands to wave when it
 * needs you); an animator pose override (setAnimPose) maps to the walk/carry/cheer states instead.
 */
export function stateClasses(pose: PoseClass, animPose: Pose | null): string[] {
  switch (animPose) {
    case 'walk':
      return ['walking'];
    case 'carry':
      return ['walking', 'carrying'];
    case 'wave':
      return ['cheer'];
    case null:
      return pose === 'pose-wave' ? [pose] : ['sitting', pose];
    default:
      return [];
  }
}

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('');
};

function hairMarkup(o: HumanLook, hy: number): { back: string; front: string } {
  const r = RIG.head;
  const c = o.hair;
  const cap = `<path d="M ${-r} ${hy} A ${r} ${r} 0 0 1 ${r} ${hy - 1} L ${r * 0.2} ${hy - r * 0.45} L ${-r * 0.6} ${hy + r * 0.55} Z" fill="${c}"/>`;
  switch (o.hairStyle) {
    case 'long':
      return { back: `<rect x="${-r - 0.5}" y="${hy - 2}" width="${r * 0.95}" height="${r * 1.7}" rx="2" fill="${c}"/>`, front: cap };
    case 'bun':
      return { back: `<circle cx="${-r * 0.8}" cy="${hy - r * 0.75}" r="3.6" fill="${c}"/>`, front: cap };
    case 'bald':
      return { back: '', front: `<ellipse cx="${-r * 0.78}" cy="${hy + 0.5}" rx="2" ry="3.6" fill="${c}"/>` };
    case 'curly': {
      const curls: [number, number, number][] = [[-0.95, 0.25, 3], [-0.8, -0.35, 3.4], [-0.45, -0.8, 3.4], [0.05, -0.95, 3.2], [0.5, -0.75, 2.8]];
      return { back: '', front: curls.map(([x, y, cr]) => `<circle cx="${r1(x * r)}" cy="${r1(hy + y * r)}" r="${cr}" fill="${c}"/>`).join('') };
    }
    case 'short':
    default:
      return { back: '', front: cap };
  }
}

/**
 * The person rig as trusted markup (hex colours and numbers only): g.body > g.rig (the body scale,
 * kept off g.body so its CSS transforms stay free) > back leg, front leg
 * (each a thigh with a .shin knee pivot ending in a shoe), and g.upper (pivots at the hip) holding the
 * back arm, torso, head, the pose-only forearm props and the front arm with a .paper in its hand.
 */
export function personMarkup(o: HumanLook, mood: Mood = 'focus', scale = 1): string {
  const S = RIG;
  const L = HALF_LEG;
  const hip = -S.leg;
  const sh = hip - S.torso;
  const hy = sh - S.head + 1;
  const w = S.w;
  const lw = r1(w * 0.42);
  const aw = r1(w * 0.32);
  const leg = (back: boolean) => {
    const k = back ? 0.82 : 1;
    return `<g class="limb leg ${back ? 'back' : 'front'}" style="transform-origin:0px ${hip}px">
        <rect x="${-lw / 2}" y="${hip}" width="${lw}" height="${L + 1}" rx="${S.rx / 2}" fill="${shade(o.pants, k)}"/>
        <g class="shin" style="transform-origin:0px ${hip + L}px">
          <rect x="${-lw / 2}" y="${hip + L}" width="${lw}" height="${L}" rx="${S.rx / 2}" fill="${shade(o.pants, k)}"/>
          <rect x="${-lw / 2}" y="-3" width="${lw + 4}" height="3" rx="1" fill="${shade('#3a3346', k)}"/>
        </g></g>`;
  };
  const arm = (back: boolean) => {
    const k = back ? 0.82 : 1;
    return `<g class="limb arm ${back ? 'back' : 'front'}" style="transform-origin:0px ${sh + 3}px">
        <rect x="${-aw / 2}" y="${sh + 2}" width="${aw}" height="${S.arm - 3}" rx="${S.rx / 2}" fill="${shade(o.shirt, k)}"/>
        <rect x="${-aw / 2}" y="${sh + S.arm - 2}" width="${aw}" height="4" rx="${S.rx / 2}" fill="${shade(o.skin, k)}"/>
        ${back ? '' : `<rect class="paper" x="-4" y="${sh + S.arm}" width="9" height="11" fill="#fff" stroke="#bbb" stroke-width=".6"/>`}
      </g>`;
  };
  const hair = hairMarkup(o, hy);
  const eye = mood === 'sleepy'
    ? `<rect x="${r1(S.head * 0.3)}" y="${hy + 0.5}" width="3" height="1" fill="#2b2540"/>`
    : `<rect class="blink" x="${r1(S.head * 0.4)}" y="${hy - 1}" width="2" height="2.4" fill="#2b2540"/>`;
  const tie = o.tie
    ? `<path d="M ${w / 2 - 5} ${sh} l 4.5 0 l -2.2 4 Z" fill="#f8fafc"/><path class="tie" d="M ${w / 2 - 3} ${sh + 1} l 2 0 l 1 ${r1(S.torso * 0.55)} l -2 2 l -2 -2 Z" fill="${o.tie}"/>`
    : '';
  // pose-only props: crossed forearms (pose-lean) and a forearm propping up the chin (pose-slump)
  const props = `<g class="forearms"><rect x="-1" y="${sh + 10}" width="${w / 2 + 3}" height="${aw}" rx="${S.rx / 2}" fill="${shade(o.shirt, 0.9)}"/>
      <rect x="${w / 2}" y="${sh + 10}" width="3.5" height="${aw}" rx="1.5" fill="${o.skin}"/></g>
    <g class="prop"><line x1="16" y1="${sh + 9}" x2="6" y2="${sh + 2}" stroke="${shade(o.shirt, 0.9)}" stroke-width="${aw}" stroke-linecap="round"/>
      <circle cx="5.5" cy="${sh + 1.5}" r="2.6" fill="${o.skin}"/></g>`;
  return `<g class="body"><g class="rig" transform="scale(${scale})">
      ${leg(true)}${leg(false)}
      <g class="upper" style="transform-origin:0px ${hip}px">
        ${arm(true)}
        <rect x="${-w / 2}" y="${sh}" width="${w}" height="${S.torso + 2}" rx="${S.rx}" fill="${o.shirt}"/>${tie}
        <rect x="-2" y="${sh - 3}" width="4" height="4" fill="${shade(o.skin, 0.9)}"/>
        ${hair.back}
        <circle cx="0" cy="${hy}" r="${S.head}" fill="${o.skin}"/>
        <circle cx="${S.head - 0.5}" cy="${hy + 1.5}" r="1.6" fill="${o.skin}"/>
        <circle cx="-1.5" cy="${hy + 1}" r="1.8" fill="${shade(o.skin, 0.88)}"/>
        ${hair.front}${eye}
        ${props}
        ${arm(false)}
      </g>
    </g></g>`;
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
      return `<g transform="translate(${r1(10 * s)},${r1(top + 12 * s)})" fill="#64748b" font-weight="700">
        <text class="zz" font-size="10">z</text><text class="zz" style="animation-delay:.8s" x="5" y="-5" font-size="12">z</text><text class="zz" style="animation-delay:1.6s" x="10" y="-11" font-size="14">z</text></g>`;
    case 'tap':
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 4)})"><g class="bubbleq"><rect x="-11" y="-8" width="22" height="15" rx="7" fill="#fff" stroke="#94a3b8"/><text y="3.5" font-size="10" font-weight="800" fill="#475569" text-anchor="middle">…</text></g></g>`;
    default:
      return '';
  }
}

/**
 * Status bubble for the compact-strip bust, shrunk into the space behind the head so it stays inside
 * the bust's viewBox (x -14.1..14.1, y -62..-26 in body units).
 */
function bustFxMarkup(fx: Fx): string {
  const bubble = (stroke: string, color: string, ch: string) =>
    `<g transform="translate(-8,-53.6) scale(.6)"><g class="bubbleq"><circle r="9" fill="#fff" stroke="${stroke}" stroke-width="2"/><text y="4.5" font-size="13" font-weight="900" fill="${color}" text-anchor="middle">${ch}</text></g></g>`;
  switch (fx) {
    case 'alert':
      return bubble('#f59e0b', '#d97706', '!');
    case 'stuck':
      return bubble('#dc2626', '#dc2626', '?');
    case 'tap':
      return bubble('#94a3b8', '#475569', '…');
    default:
      return '';
  }
}

/**
 * Builds a character group; see updateCharacter for the attributes it carries.
 * Structure: g.char (positioned by its caller via the transform attribute; carries the state and
 * pose classes and --L) > g.anim (owned by the animator: Web Animations offsets/opacity only) >
 * g.dir (free for facing flips) > g.body (the rig, see personMarkup), plus g.fx and g.tag beside g.dir.
 * The body scale lives on g.rig inside g.body, so g.dir and g.body keep their CSS transforms free
 * (--L is therefore in screen px). The two position transforms compose, so a snapshot re-placing
 * g.char never clobbers a walk in progress.
 */
export function renderCharacter(opts: CharacterOpts): SVGGElement {
  const g = svgEl('g', { class: 'char' });
  const anim = svgEl('g', { class: 'anim' }, g);
  const dir = svgEl('g', { class: 'dir' }, anim);
  dir.dataset.sig = '';
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
 * Overrides the seated status pose while an animation runs ('walk' → walking, 'carry' → walking +
 * carrying, 'wave' → cheer, 'stand' → standing still); null restores the pose from state.
 * Survives snapshot updates until cleared.
 */
export function setAnimPose(g: SVGGElement, pose: Pose | null): void {
  if (pose) g.dataset.animPose = pose;
  else delete g.dataset.animPose;
  const o = lastOpts.get(g);
  if (o) updateCharacter(g, o);
}

/**
 * Animator-owned state classes for a running step (e.g. ['walking', 'carrying'], or [] while just
 * standing); null hands the classes back to the status pose (seated). Kept in data-step, so they
 * survive snapshot updates until the animator clears them. Applied at once.
 */
export function setStepClasses(g: SVGGElement, classes: string[] | null): void {
  if (classes) g.dataset.step = classes.join(' ');
  else delete g.dataset.step;
  applyClasses(g);
}

/**
 * The receiver of a handoff waves ('cheer') on top of whatever it is doing; survives snapshots.
 * Counted (data-cheer), so overlapping celebrates on one receiver keep it waving until the last ends.
 */
export function setCheer(g: SVGGElement, on: boolean): void {
  const n = Math.max(0, (Number(g.dataset.cheer) || 0) + (on ? 1 : -1));
  if (n > 0) g.dataset.cheer = String(n);
  else delete g.dataset.cheer;
  applyClasses(g);
}

/** Current animator step classes (data-step), or null when the status pose rules. */
export function stepClassesOf(g: SVGGElement): string[] | null {
  const s = g.dataset.step;
  return s === undefined ? null : s.split(' ').filter(Boolean);
}

/**
 * Sets g.char's state and pose classes from data-pose (the status pose), data-step (a running
 * animator step), data-cheer and data-animPose; only touches the class list when the set changes.
 * Pose classes stay on during a step: CSS ignores them while walking.
 */
function applyClasses(g: SVGGElement): void {
  const pose = g.dataset.pose as PoseClass | undefined;
  let classes: string[];
  if (g.dataset.bust) classes = ['bust', ...(pose ? [pose] : [])];
  else {
    const step = stepClassesOf(g);
    if (step) classes = pose ? [...step, pose] : step;
    else classes = stateClasses(pose ?? 'pose-idle', (g.dataset.animPose as Pose | undefined) ?? null).filter((c) => pose || !c.startsWith('pose-'));
    if (g.dataset.cheer && !classes.includes('cheer')) classes = [...classes, 'cheer'];
  }
  const classSig = classes.join(' ');
  if (g.dataset.state !== classSig) {
    g.dataset.state = classSig;
    g.classList.remove(...STATE_CLASSES, ...POSE_CLASSES, 'bust');
    if (classes.length) g.classList.add(...classes);
  }
}

/**
 * Updates a character in place. The rig (and its CSS animations) is only rebuilt when the look,
 * mood or scale change; state/pose classes only when they change (so classes toggled by an animator
 * survive snapshots that leave the pose alone); overlays only when the status overlay changes.
 * Position is not touched here: the caller sets the group's transform.
 */
export function updateCharacter(g: SVGGElement, o: CharacterOpts): void {
  lastOpts.set(g, o);
  const s = o.scale ?? 1;
  const fx = o.fx ?? 'none';
  g.dataset.agentId = o.id;
  if (o.sessionId !== undefined) g.dataset.sessionId = o.sessionId;
  g.dataset.pose = o.pose;
  g.dataset.mood = o.mood;
  g.style.setProperty('--L', `${r1(HALF_LEG * s)}px`);

  if (o.bust) g.dataset.bust = '1';
  applyClasses(g);

  const dir = g.querySelector<SVGGElement>(':scope > .anim > .dir')!;
  const h = o.human;
  const sig = [h.skin, h.hair, h.hairStyle, h.shirt, h.pants, h.tie ?? '', o.mood, s].join('|');
  if (dir.dataset.sig !== sig) {
    dir.dataset.sig = sig;
    dir.replaceChildren();
    html(dir, personMarkup(h, o.mood, s));
  }

  const fxg = g.querySelector<SVGGElement>(':scope > .anim > .fx')!;
  const fxSig = `${fx}|${s}|${o.bust ? 'bust' : ''}`;
  if (fxg.dataset.sig !== fxSig) {
    fxg.dataset.sig = fxSig;
    fxg.replaceChildren();
    html(fxg, o.bust ? bustFxMarkup(fx) : fxMarkup(fx, s));
  }
  const timer = fxg.querySelector<SVGTextElement>('.timer');
  if (timer) {
    timer.dataset.since = String(o.since ?? Date.now());
    paintTimer(timer, Date.now());
  }

  // name tag stack, fixed pixel size, above the standing head (CSS drops it by --L when seated)
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
  if (!tok.dataset.ticking) writeTok(tok, o.tokens); // main.ts counts it up between snapshots
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

// Furniture in body units, seat-local: the seated character's feet are at (0, 0) and it faces +x.
// Geometry follows the mockup's furniture(): the chair seat is half a leg up, the desk starts just past
// the knees and its top is at typing height. A workstation spans [-21, 84] (see layout.ts).
const SEAT_Y = -HALF_LEG;
const DESK_X = 16;
const DESK_W = 66;
const DESK_TOP = Math.round(-HALF_LEG - RIG.torso * 0.55);
/** monitor screen, matching the #scr1 clip path in index.html */
const SCR = { x: 48, y: DESK_TOP - 21, w: 26, h: 14 };

/** Monitor lines: code scrolling up, or red error lines. */
function screenMarkup(screen: Screen): string {
  const err = screen === 'err';
  const lines = Array.from({ length: 20 }, (_, i) => {
    const fill = err ? '#f87171' : ['#7ee787', '#79c0ff', '#d2a8ff'][i % 3];
    return `<rect x="${SCR.x + 1.5 + (i % 3) * 2}" y="${SCR.y + 1.5 + i * 3}" width="${6 + ((i * 7) % 14)}" height="1.4" rx=".6" fill="${fill}"/>`;
  }).join('');
  return `<rect x="${SCR.x}" y="${SCR.y}" width="${SCR.w}" height="${SCR.h}" fill="${err ? '#3f0d12' : '#0b1220'}"/><g class="scroll">${lines}</g>`;
}

/** A desk with a monitor, keyboard and (optionally) a mug; place it at the seat, scaled. */
export function renderDesk(screen: Screen = 'code', mug = true): SVGGElement {
  const g = svgEl('g', { class: 'desk' });
  const T = DESK_TOP;
  const R = DESK_X + DESK_W;
  html(
    g,
    `<rect x="${DESK_X + 3}" y="${T + 4}" width="3" height="${-T - 4}" fill="#6b442d"/>
    <rect x="${R - 6}" y="${T + 4}" width="3" height="${-T - 4}" fill="#6b442d"/>
    <rect x="${R - 30}" y="${T + 4}" width="27" height="10" fill="#7a4e33"/><rect x="${R - 19}" y="${T + 8}" width="6" height="1.5" rx=".7" fill="#c9a27a"/>
    <rect x="${DESK_X}" y="${T}" width="${DESK_W}" height="4" rx="1" fill="#8a5a3c"/>
    <rect x="${SCR.x + SCR.w / 2 - 1.5}" y="${SCR.y + SCR.h + 1}" width="3" height="${T - SCR.y - SCR.h - 1}" fill="#374151"/>
    <rect x="${SCR.x + SCR.w / 2 - 6}" y="${T - 1.5}" width="12" height="1.5" rx=".7" fill="#374151"/>
    <rect x="${SCR.x - 2}" y="${SCR.y - 2}" width="${SCR.w + 4}" height="${SCR.h + 4}" rx="2" fill="#1f2937"/>
    <g class="screen" clip-path="url(#scr1)"></g>
    <rect x="${DESK_X + 4}" y="${T - 1.5}" width="15" height="1.5" rx=".7" fill="#d1d5db"/>` +
      (mug
        ? `<g transform="translate(${DESK_X + 25},${T - 5})"><rect x="-2.5" y="0" width="5" height="5" rx="1" fill="#fff" stroke="#bbb" stroke-width=".6"/><path class="steam" d="M-1 -1 q1 -2 0 -4 M1.2 -1 q1 -2 0 -4" stroke="#bbb" stroke-width=".7" fill="none"/></g>`
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

/** An office chair behind the seated character; the boss's is bigger, with a headrest and wheels. */
/** The x (seat-local body units) of the visitor chair: past the far end of the boss's desk. */
export const VISITOR_X = DESK_X + DESK_W + 14;

/**
 * The person's own chair, across the boss's desk and facing it. Dim while the lead works; with
 * `waiting` (the lead is blocked on the person) it glows and shows a "your turn" tag (CSS: .waiting).
 */
export function renderVisitorChair(): SVGGElement {
  const g = svgEl('g', { class: 'chair chair--visitor' });
  const Y = SEAT_Y;
  const backH = r1(RIG.torso * 0.9);
  html(
    g,
    `<ellipse class="v-glow" cx="0" cy="0" rx="18" ry="4.5"/>
    <g transform="scale(-1,1)">
      <rect class="v-back" x="-11" y="${r1(Y - backH)}" width="4" height="${backH}" rx="1"/>
      <rect class="v-seat" x="-11" y="${Y}" width="22" height="4" rx="1.5"/>
      <rect x="-1" y="${Y + 4}" width="2" height="${HALF_LEG - 6}" fill="#3a3346"/>
      <rect x="-8" y="-2" width="16" height="2" fill="#3a3346"/>
    </g>
    <g transform="translate(0,${r1(Y - backH - 12)})"><g class="v-tag">
      <rect x="-21" y="-7" width="42" height="11" rx="5.5"/>
      <text x="0" y="1.2" font-size="6.5" font-weight="700" text-anchor="middle">your turn</text>
    </g></g>`,
  );
  return g;
}

export function renderChair(boss: boolean): SVGGElement {
  const g = svgEl('g', { class: boss ? 'chair chair--boss' : 'chair' });
  const Y = SEAT_Y;
  if (boss) {
    const backH = RIG.torso * 1.3;
    html(
      g,
      `<rect x="-15" y="${r1(Y - backH)}" width="7" height="${r1(backH)}" rx="3" fill="#2b2540"/>
      <rect x="-14" y="${r1(Y - backH - 4)}" width="8" height="6" rx="3" fill="#3d3a5c"/>
      <rect x="-14" y="${Y}" width="28" height="5" rx="2" fill="#3d3a5c"/>
      <rect x="-1.5" y="${Y + 5}" width="3" height="${HALF_LEG - 8}" fill="#2b2540"/>
      <rect x="-11" y="-3" width="22" height="2" fill="#2b2540"/>
      <circle cx="-10" cy="-1" r="1.4" fill="#111"/><circle cx="10" cy="-1" r="1.4" fill="#111"/>`,
    );
  } else {
    const backH = r1(RIG.torso * 0.9);
    html(
      g,
      `<rect x="-11" y="${r1(Y - backH)}" width="4" height="${backH}" rx="1" fill="#5a4a6a"/>
      <rect x="-11" y="${Y}" width="22" height="4" rx="1.5" fill="#6b5b7b"/>
      <rect x="-1" y="${Y + 4}" width="2" height="${HALF_LEG - 6}" fill="#3a3346"/>
      <rect x="-8" y="-2" width="16" height="2" fill="#3a3346"/>`,
    );
  }
  return g;
}
