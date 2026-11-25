// Life-cycle animations: spawn (door, sparkle, walk to desk), handoff (walk to boss or parent,
// paper, "Got it, thanks!", confetti, the finisher's victory dance), exit (walk out the door), shift change and room fades.
// planAnimations is pure (tested under node); the runner is browser-only (Web Animations API).
//
// Status poses (quiet → scratch/sweat/red timer, needs_you → raised hand + "!", idle → zzz,
// waiting_on_team → foot tap) come from state via looks.ts, not from here.
//
// DOM contract (see characters.ts / rooms.ts):
// - g.char is positioned at its seat by rooms.ts (transform attribute, mirrored in data-x/data-y).
// - Its child g.anim is owned by this runner: walks are CSS transform offsets relative to the
//   seat, so snapshot updates that re-place g.char never clobber a walk in progress.
// - Limbs are driven by state classes on g.char (walking, sitting, carrying, giving, cheer; see
//   styles.css): each step applies stepClasses(kind) through characters.setStepClasses, so they
//   survive snapshot re-renders until the step sequence ends and hands the classes back to the
//   status pose. g.dir is flipped (scale(±1,1)) to face the way the character walks.
// - A character mid handoff/exit carries data-departing; rooms.ts keeps it rendered after its
//   agent goes 'gone' (and loses its seat) until exit_door finishes and removes it here.
import type { OfficeEvent, OfficeState } from '../shared/types.js';
import { HEAD_TOP, TAG_H, handoffTarget, type Point, type RoomLayout } from './layout.js';
import { STATE_CLASSES, setCheer, setStepClasses, stepClassesOf, svgEl } from './characters.js';
import { layoutOf } from './rooms.js';

export type AnimKind =
  | 'enter_door'
  | 'walk_to_desk'
  | 'walk_to'
  | 'give'
  | 'celebrate'
  | 'exit_door'
  | 'shift_change'
  | 'fade_in_room'
  | 'fade_out_room';

/**
 * One animation step. Steps queue per (sessionId, agentId) and run in order.
 * - Room steps (fade_in_room / fade_out_room) use agentId ROOM_ACTOR ('').
 * - give / celebrate are queued on the handing-off agent; targetId names who receives
 *   (and celebrates): 'boss' or the parent agent id.
 * - shift_change: agentId 'boss' of the new session, targetId = the old session id.
 */
export type AnimStep = { agentId: string; sessionId: string; kind: AnimKind; targetId?: string; durationMs: number };

export const ROOM_ACTOR = '';

/**
 * Dispatched on the svg root (detail: { sessionId }) when an ended room's fade-out completes;
 * the floor then drops the room while its session stays ended (see layout.visibleSessions).
 */
export const ROOM_FADED_EVENT = 'agentoffice:room-faded';

export const DURATIONS: Record<AnimKind, number> = {
  enter_door: 1200,
  walk_to_desk: 2000,
  walk_to: 2000,
  give: 800,
  celebrate: 1800,
  exit_door: 2000,
  shift_change: 2000,
  fade_in_room: 600,
  fade_out_room: 600,
};

/** Walks become a fade of this length under prefers-reduced-motion. */
const REDUCED_MS = 300;

/** State classes a step adds to / removes from the walker when it starts (see the brief's table). */
export function stepClasses(kind: AnimKind): { add: string[]; remove: string[] } {
  switch (kind) {
    case 'enter_door':
    case 'walk_to_desk':
    case 'shift_change':
      return { add: ['walking'], remove: ['sitting'] };
    case 'walk_to':
      return { add: ['walking', 'carrying'], remove: ['sitting'] };
    case 'give':
      return { add: ['giving'], remove: ['walking', 'carrying'] };
    case 'exit_door':
      return { add: ['walking'], remove: ['giving', 'carrying', 'sitting', 'dancing'] };
    case 'celebrate':
      // the finisher does a little victory dance while the receiver cheers
      return { add: ['dancing'], remove: ['giving'] };
    default:
      // room fades have no walker
      return { add: [], remove: [] };
  }
}

/** Which way to face (1 right, -1 left) when moving from fromX to toX; tiny moves keep `current`. */
export function facing(fromX: number, toX: number, current: 1 | -1): 1 | -1 {
  const dx = toX - fromX;
  if (Math.abs(dx) < 1) return current;
  return dx > 0 ? 1 : -1;
}

/** Turns store events into animation steps. Steps for sessions not in state are dropped. */
export function planAnimations(events: OfficeEvent[], state: OfficeState): AnimStep[] {
  let out: AnimStep[] = [];
  const add = (sessionId: string, agentId: string, kind: AnimKind, targetId?: string) =>
    out.push({ agentId, sessionId, kind, ...(targetId !== undefined ? { targetId } : {}), durationMs: DURATIONS[kind] });
  const dropFadeOut = (sid: string) => (out = out.filter((s) => !(s.kind === 'fade_out_room' && s.sessionId === sid)));
  for (const e of events) {
    switch (e.kind) {
      case 'spawned':
        add(e.sessionId, e.agentId, 'enter_door');
        add(e.sessionId, e.agentId, 'walk_to_desk');
        break;
      case 'handoff':
        add(e.sessionId, e.agentId, 'walk_to', e.toId);
        add(e.sessionId, e.agentId, 'give', e.toId);
        add(e.sessionId, e.agentId, 'celebrate', e.toId);
        break;
      case 'left':
        add(e.sessionId, e.agentId, 'exit_door');
        break;
      case 'shift_change':
        // /clear can emit session_ended then shift_change: the room is taken over, not closed
        dropFadeOut(e.fromSessionId);
        dropFadeOut(e.toSessionId);
        add(e.toSessionId, 'boss', 'shift_change', e.fromSessionId);
        break;
      case 'session_started':
        dropFadeOut(e.sessionId);
        add(e.sessionId, ROOM_ACTOR, 'fade_in_room');
        break;
      case 'session_ended':
        add(e.sessionId, ROOM_ACTOR, 'fade_out_room');
        break;
    }
  }
  return out.filter((s) => !!state.sessions[s.sessionId]);
}

// ------------------------------------------------------------------ runner (browser-only)

type Queue = { busy: boolean; items: AnimStep[]; running: Set<Animation> };
const queues = new Map<string, Queue>();

/** Debug counters (exposed as window.agentOffice.anim). */
export const animStats = {
  started: 0,
  finished: 0,
  /** steps whose room/character was no longer rendered */
  skipped: 0,
  cancelled: 0,
  byKind: {} as Record<string, { started: number; finished: number }>,
  log: [] as string[],
};

const qkey = (sessionId: string, agentId: string) => `${sessionId}\u0000${agentId}`;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const tr = (p: Point) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;

function roomEl(svg: SVGSVGElement, sid: string): SVGGElement | null {
  return svg.querySelector<SVGGElement>(`g.room[data-session-id="${CSS.escape(sid)}"]`);
}
function charEl(room: Element, id: string): SVGGElement | null {
  return room.querySelector<SVGGElement>(`.people > g.char[data-agent-id="${CSS.escape(id)}"]`);
}

/**
 * Queues steps per agent and starts idle queues. Characters about to hand off or leave are marked
 * departing right away, so a render that follows in the same task keeps them. Steps start on a
 * microtask: call this before rendering the matching state, and new characters will exist (and be
 * hidden at the door) before the next paint.
 */
export function runAnimations(steps: AnimStep[], svgRoot: SVGSVGElement): void {
  for (const s of steps) {
    if (s.kind === 'walk_to' || s.kind === 'exit_door') {
      const room = roomEl(svgRoot, s.sessionId);
      const c = room && charEl(room, s.agentId);
      if (c) c.dataset.departing = '1';
    }
    if (s.kind === 'shift_change' && s.targetId) cancelQueue(svgRoot, s.targetId, ROOM_ACTOR);
    if (s.kind === 'fade_in_room') cancelQueue(svgRoot, s.sessionId, ROOM_ACTOR);
    const k = qkey(s.sessionId, s.agentId);
    let q = queues.get(k);
    if (!q) queues.set(k, (q = { busy: false, items: [], running: new Set() }));
    q.items.push(s);
    queueMicrotask(() => pump(k, svgRoot));
  }
}

/** Drops pending steps and stops running ones for one actor (room fades: agentId ROOM_ACTOR). */
function cancelQueue(svg: SVGSVGElement, sessionId: string, agentId: string): void {
  // a finished fade_out_room leaves the room faded; undo that too
  if (agentId === ROOM_ACTOR) roomEl(svg, sessionId)?.style.removeProperty('opacity');
  const q = queues.get(qkey(sessionId, agentId));
  if (!q) return;
  animStats.cancelled += q.items.length + q.running.size;
  q.items = [];
  for (const a of q.running) cancelAnimation(a);
  q.running.clear();
  if (agentId !== ROOM_ACTOR) {
    const room = roomEl(svg, sessionId);
    const c = room && charEl(room, agentId);
    if (c) restoreSeated(c);
  }
}

const cancelledAnims = new WeakSet<Animation>();
/** Explicit cancellation: the step's end state is discarded (unlike a timeout, see tween). */
export function cancelAnimation(a: Animation): void {
  cancelledAnims.add(a);
  a.cancel();
}

function pump(k: string, svg: SVGSVGElement): void {
  const q = queues.get(k);
  if (!q || q.busy) return;
  const step = q.items.shift();
  if (!step) {
    queues.delete(k);
    return;
  }
  q.busy = true;
  const bucket = (animStats.byKind[step.kind] ??= { started: 0, finished: 0 });
  animStats.started++;
  bucket.started++;
  play(step, svg, q)
    .then((ran) => {
      if (!ran) animStats.skipped++;
      animStats.finished++;
      bucket.finished++;
      animStats.log.push(`${ran ? 'done' : 'skip'} ${step.kind} ${step.agentId || 'room'}`);
      if (animStats.log.length > 200) animStats.log.shift();
    })
    .catch(() => {
      animStats.finished++;
      bucket.finished++;
    })
    .finally(() => {
      q.busy = false;
      pump(k, svg);
    });
}

/** Resolves when the animation finishes, is cancelled, or after a safety timeout. */
function done(a: Animation, ms: number): Promise<void> {
  return Promise.race([a.finished.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms + 1000))]);
}

type Ctx = { q: Pick<Queue, 'running'>; reduced: boolean };

/**
 * Runs an animation tracked by the queue (so it can be cancelled) and keeps its last keyframe as
 * inline style. The end state is committed when the animation finishes AND when the safety timeout
 * fires first (a hidden tab or throttled webview stalls the timeline), so a character never stays
 * invisible or half-way; it is discarded only after an explicit cancelAnimation.
 * Resolves false when cancelled.
 */
export async function tween(ctx: Ctx, el: Element, kf: Keyframe[], ms: number, easing = 'ease-in-out', keep = true): Promise<boolean> {
  const a = el.animate(kf, { duration: ms, easing, fill: 'forwards' });
  ctx.q.running.add(a);
  await done(a, ms);
  ctx.q.running.delete(a);
  const cancelled = cancelledAnims.has(a);
  if (keep && !cancelled) {
    const last = kf[kf.length - 1];
    const st = (el as SVGElement).style;
    if (last.transform !== undefined) st.transform = String(last.transform);
    if (last.opacity !== undefined) st.opacity = String(last.opacity);
  }
  if (!cancelled) a.cancel();
  return !cancelled;
}
const animate = tween;

/** Fire-and-forget overlay animation; removes `remove` (default: the element) when done. */
function flourish(el: SVGElement, kf: Keyframe[], ms: number, opts: KeyframeAnimationOptions = {}, remove: Element = el): void {
  const a = el.animate(kf, { duration: ms, fill: 'forwards', ...opts });
  void done(a, ms).then(() => remove.remove());
}

// ------------------------------------------------------------------ walking and sitting

/** Standing up from / sitting down on the chair eases over this long (see .settling in styles.css). */
const SETTLE_MS = 450;
/** A seated character stands up for this long before it starts walking. */
const STAND_MS = 350;

const settleTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
/** Holds the walk/breathe cycles for SETTLE_MS so the rig's transforms transition (sit/stand). */
function settle(c: SVGGElement): void {
  c.classList.add('settling');
  const t = settleTimers.get(c);
  if (t !== undefined) clearTimeout(t);
  settleTimers.set(c, setTimeout(() => c.classList.remove('settling'), SETTLE_MS));
}

/** Ends a settle early (the walk cycle takes over from here). */
function unsettle(c: SVGGElement): void {
  const t = settleTimers.get(c);
  if (t !== undefined) clearTimeout(t);
  settleTimers.delete(c);
  c.classList.remove('settling');
}

function dirOf(c: SVGGElement): SVGGElement | null {
  return c.querySelector<SVGGElement>(':scope > .anim > .dir');
}
function currentFacing(c: SVGGElement): 1 | -1 {
  return c.dataset.face === '-1' ? -1 : 1;
}
/** Flips g.dir to face f (1: right, the rig's natural and seated direction). */
function face(c: SVGGElement, f: 1 | -1): void {
  c.dataset.face = String(f);
  const dir = dirOf(c);
  if (dir) dir.style.transform = `scale(${f},1)`;
}

/** The walker's state classes now: its running step's, or (between steps) the ones on the element. */
function currentStep(c: SVGGElement): string[] {
  return stepClassesOf(c) ?? STATE_CLASSES.filter((k) => k !== 'cheer' && c.classList.contains(k));
}
/** Applies a step's add/remove delta on top of the walker's current state classes. */
function applyDelta(c: SVGGElement, add: string[], remove: string[]): void {
  const cur = new Set(currentStep(c));
  for (const k of remove) cur.delete(k);
  for (const k of add) cur.add(k);
  setStepClasses(c, [...cur]);
}

/** Back to the seated status pose at the seat, facing the desk (a cancelled queue, a kept exit). */
function restoreSeated(c: SVGGElement): void {
  const anim = c.querySelector<SVGGElement>(':scope > .anim');
  if (anim) setOffset(anim, { x: 0, y: 0 }, 1);
  delete c.dataset.departing;
  face(c, 1);
  setStepClasses(c, null);
}

/**
 * One walking step of a character: applies stepClasses(kind), faces the way it travels, and moves
 * g.anim from `from` to `to` (offsets from the seat) over ms, or plays `kf` instead when given.
 * A seated walker first stands up (walk_to / exit_door). On finish, or on the stalled-timeline
 * commit, walk_to_desk / shift_change sit down: the status pose takes the classes back (sitting,
 * no walking) and it faces the desk. A cancelled walk restores the seated state.
 * Resolves false when cancelled.
 */
export async function walkStep(ctx: Ctx, c: SVGGElement, kind: AnimKind, from: Point, to: Point, ms: number, kf?: Keyframe[]): Promise<boolean> {
  const anim = c.querySelector<SVGGElement>(':scope > .anim');
  if (!anim) return false;
  const { add, remove } = stepClasses(kind);
  const standUp = !ctx.reduced && (kind === 'walk_to' || kind === 'exit_door') && currentStep(c).includes('sitting');
  if (standUp) {
    // stand beside the chair first (the rig eases up), then set off
    applyDelta(c, add.filter((k) => k !== 'walking'), remove);
    settle(c);
    await wait(STAND_MS);
    // cancelled while standing up (cancelQueue restored the seated state)
    if (stepClassesOf(c) === null) return false;
    // standing: drop the settle hold now, so the walk cycle (body bob included) starts with the move
    unsettle(c);
    ms = Math.max(REDUCED_MS, ms - STAND_MS);
  }
  applyDelta(c, add, remove);
  if (!ctx.reduced) face(c, facing(from.x, to.x, currentFacing(c)));
  const ok = await tween(ctx, anim, kf ?? [{ transform: tr(from), opacity: 1 }, { transform: tr(to), opacity: 1 }], ms);
  if (!ok) {
    restoreSeated(c);
    return false;
  }
  offsets.set(anim, to);
  if (kind === 'walk_to_desk' || kind === 'shift_change') {
    if (!ctx.reduced) settle(c);
    applyDelta(c, ['sitting'], ['walking']);
    face(c, 1);
    setStepClasses(c, null);
  }
  return true;
}

// per character: current animation offset from its seat
const offsets = new WeakMap<Element, Point>();
function setOffset(anim: SVGGElement, p: Point, opacity?: number): void {
  offsets.set(anim, p);
  anim.style.transform = tr(p);
  if (opacity !== undefined) anim.style.opacity = String(opacity);
}
function basePos(c: SVGGElement): Point {
  return { x: Number(c.dataset.x) || 0, y: Number(c.dataset.y) || 0 };
}

function openDoor(ctx: Ctx, room: SVGGElement, ms: number): void {
  if (ctx.reduced) return;
  const leaf = room.querySelector<SVGElement>('.bg .doorL');
  if (!leaf) return;
  leaf.animate(
    [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.15)', offset: 0.2 }, { transform: 'scaleX(.15)', offset: 0.75 }, { transform: 'scaleX(1)' }],
    { duration: ms, easing: 'ease-in-out' },
  );
}

function fxLayer(room: SVGGElement): SVGGElement {
  let fx = room.querySelector<SVGGElement>('.room-inner > .anim-fx');
  if (!fx) fx = svgEl('g', { class: 'anim-fx' }, room.querySelector('.room-inner') ?? room);
  return fx;
}

/**
 * A pill label (e.g. "New agent spawned!") centred at p and kept inside [0, roomW]. Returns the
 * inner group to animate; remove its parentElement when done.
 */
function pill(parent: SVGGElement, p: Point, roomW: number, text: string, fill: string, fontSize = 10): SVGGElement {
  const w = Math.round(text.length * fontSize * 0.62 + 16);
  const x = Math.max(w / 2 + 4, Math.min(roomW - w / 2 - 4, p.x));
  const outer = svgEl('g', { transform: `translate(${Math.round(x)},${Math.round(p.y)})` }, parent);
  const g = svgEl('g', { class: 'pop' }, outer);
  svgEl('rect', { x: -w / 2, y: -fontSize - 4, width: w, height: fontSize + 10, rx: (fontSize + 10) / 2, fill }, g);
  const t = svgEl('text', { y: 0, 'font-size': fontSize, 'font-weight': 700, fill: '#fff', 'text-anchor': 'middle' }, g);
  t.textContent = text;
  return g;
}

/** A label by the door that fades in, holds and fades out over ms; with a sparkle unless reduced. */
function doorTag(ctx: Ctx, room: SVGGElement, layout: RoomLayout, label: string, color: string, ms: number, withSparkle: boolean): void {
  const fx = fxLayer(room);
  const at = layout.door;
  if (withSparkle && !ctx.reduced) {
    const outer = svgEl('g', { transform: `translate(${Math.round(at.x)},${Math.round(at.y - 18)})` }, fx);
    const s = svgEl('text', { class: 'pop', 'font-size': 30, 'text-anchor': 'middle', y: 10 }, outer);
    s.textContent = '✨';
    flourish(s, [
      { opacity: 0, transform: 'scale(.2)' },
      { opacity: 1, transform: 'scale(1.3)', offset: 0.3 },
      { opacity: 0, transform: 'scale(1.6)' },
    ], ms * 0.6, {}, outer);
  }
  // below the door, clear of the newcomer's own name tag above its head
  const tag = pill(fx, { x: at.x - 30, y: Math.min(layout.rect.h - 8, at.y + 34) }, layout.rect.w, label, color);
  flourish(tag, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], ms, {}, tag.parentElement!);
}

function confetti(room: SVGGElement, at: Point): void {
  const fx = fxLayer(room);
  const g = svgEl('g', { transform: `translate(${Math.round(at.x)},${Math.round(at.y)})` }, fx);
  const colors = ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];
  for (let i = 0; i < 18; i++) {
    const r = svgEl('rect', { width: 5, height: 8, fill: colors[i % 5] }, g);
    const dx = Math.round(Math.cos(i) * 70);
    const dy = Math.round(Math.sin(i) * 60 - 40);
    flourish(r, [
      { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg)' },
      { opacity: 1, transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) rotate(180deg)`, offset: 0.6 },
      { opacity: 0, transform: `translate(${dx}px, ${dy + 25}px) rotate(260deg)` },
    ], 1100 + (i % 4) * 60, { easing: 'ease-out' });
  }
  setTimeout(() => g.remove(), 2500);
}

/** Plays one step. Resolves false when there was nothing on screen to animate. */
async function play(step: AnimStep, svg: SVGSVGElement, q: Queue): Promise<boolean> {
  const ctx: Ctx = { q, reduced: reduced() };
  const room = roomEl(svg, step.sessionId);
  if (!room) return false;
  const layout = layoutOf(room);
  if (!layout) return false;
  const ms = step.durationMs;

  if (step.kind === 'fade_in_room') {
    room.style.removeProperty('opacity');
    await animate(ctx, room, [{ opacity: 0 }, { opacity: 1 }], ms, 'ease-out', false);
    room.style.removeProperty('opacity');
    return true;
  }
  if (step.kind === 'fade_out_room') {
    // fade the ended room out (at once under reduced motion), then tell the floor to drop it;
    // a revival (fade_in_room / shift_change) cancels this and keeps the room
    const ok = await animate(ctx, room, [{ opacity: 1 }, { opacity: 0 }], ctx.reduced ? 0 : ms, 'ease-in');
    if (ok) svg.dispatchEvent(new CustomEvent(ROOM_FADED_EVENT, { detail: { sessionId: step.sessionId } }));
    return true;
  }

  const c = charEl(room, step.agentId);
  const anim = c?.querySelector<SVGGElement>(':scope > .anim');
  if (!c || !anim) return false;
  const base = basePos(c);
  const off = offsets.get(anim) ?? { x: 0, y: 0 };
  const walkMs = ctx.reduced ? REDUCED_MS : ms;

  switch (step.kind) {
    case 'enter_door': {
      const at = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      doorTag(ctx, room, layout, 'New agent spawned!', '#ec4899', ms * 2, true);
      if (ctx.reduced) {
        const e = stepClasses('enter_door');
        applyDelta(c, e.add, e.remove);
        setOffset(anim, { x: 0, y: 0 }, 0);
        return true;
      }
      // step out of the doorway, fading in, already facing the seat
      const behind = { x: at.x, y: at.y - 6 };
      setOffset(anim, behind, 0);
      openDoor(ctx, room, ms + 600);
      face(c, facing(layout.door.x, base.x, currentFacing(c)));
      return walkStep(ctx, c, 'enter_door', behind, at, ms, [
        { transform: tr(behind), opacity: 0 },
        { transform: tr(behind), opacity: 0, offset: 0.3 },
        { transform: tr(at), opacity: 1 },
      ]);
    }
    case 'walk_to_desk': {
      if (ctx.reduced) {
        setOffset(anim, { x: 0, y: 0 });
        return walkStep(ctx, c, 'walk_to_desk', off, { x: 0, y: 0 }, walkMs, [{ opacity: 0 }, { opacity: 1 }]);
      }
      return walkStep(ctx, c, 'walk_to_desk', off, { x: 0, y: 0 }, walkMs);
    }
    case 'walk_to': {
      c.dataset.departing = '1';
      const t = handoffTarget(layout, { parentId: step.targetId && step.targetId !== 'boss' ? step.targetId : null });
      const to = { x: t.x - base.x, y: t.y - base.y };
      if (ctx.reduced) {
        // no walk: a fade to the receiver
        setOffset(anim, to, 0);
        return walkStep(ctx, c, 'walk_to', to, to, REDUCED_MS, [{ opacity: 0 }, { opacity: 1 }]);
      }
      return walkStep(ctx, c, 'walk_to', off, to, walkMs);
    }
    case 'give': {
      // raise the paper (the rig's own, in the hand) towards the receiver
      const g = stepClasses('give');
      applyDelta(c, g.add, g.remove);
      const target = receiver(room, layout, step.targetId);
      if (target && !ctx.reduced) face(c, facing(base.x + off.x, target.x, currentFacing(c)));
      await wait(ctx.reduced ? REDUCED_MS : ms);
      return true;
    }
    case 'celebrate': {
      const d = stepClasses('celebrate');
      applyDelta(c, d.add, d.remove);
      const target = receiver(room, layout, step.targetId);
      if (!target) {
        await wait(ms);
        return true;
      }
      if (target.el) setCheer(target.el, true);
      const fx = fxLayer(room);
      const bubble = pill(fx, { x: target.x, y: Math.max(16, target.y - HEAD_TOP * target.scale - TAG_H - 10) }, layout.rect.w, '✓ Got it, thanks!', '#16a34a', 11);
      bubble.style.transformBox = 'fill-box';
      bubble.style.transformOrigin = 'bottom left';
      if (!ctx.reduced) {
        confetti(room, { x: target.x + 30 * target.scale, y: target.y - 40 * target.scale });
        // a little hop, added on top of whatever the receiver's wrapper is doing
        target.anim?.animate(
          [{ transform: 'translateY(0px)' }, { transform: 'translateY(-8px)', offset: 0.25 }, { transform: 'translateY(0px)', offset: 0.5 }, { transform: 'translateY(-5px)', offset: 0.7 }, { transform: 'translateY(0px)' }],
          { duration: 700, easing: 'ease-out', composite: 'add' },
        );
      }
      const kf: Keyframe[] = ctx.reduced
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: 'scale(.3)' },
            { opacity: 1, transform: 'scale(1.15)', offset: 0.15 },
            { opacity: 1, transform: 'scale(1)', offset: 0.25 },
            { opacity: 1, transform: 'scale(1)', offset: 0.8 },
            { opacity: 0, transform: 'scale(1)' },
          ];
      const a = bubble.animate(kf, { duration: ms, fill: 'forwards' });
      q.running.add(a);
      try {
        await done(a, ms);
      } finally {
        q.running.delete(a);
        bubble.parentElement?.remove();
        if (target.el) setCheer(target.el, false);
      }
      return true;
    }
    case 'exit_door': {
      c.dataset.departing = '1';
      const to = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      let ok: boolean;
      if (ctx.reduced) {
        ok = await walkStep(ctx, c, 'exit_door', off, off, REDUCED_MS, [{ opacity: 1 }, { opacity: 0 }]);
      } else {
        openDoor(ctx, room, ms);
        ok = await walkStep(ctx, c, 'exit_door', off, to, ms, [{ transform: tr(off), opacity: 1 }, { transform: tr(to), opacity: 1, offset: 0.8 }, { transform: tr(to), opacity: 0 }]);
      }
      if (!ok) return true;
      // gone: remove it now (rooms.ts kept it alive for this); a seated agent is restored instead
      if (!layoutOf(room)?.seats[step.agentId]) c.remove();
      else restoreSeated(c);
      return true;
    }
    case 'shift_change': {
      const at = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      doorTag(ctx, room, layout, 'Shift change!', '#8b5cf6', ms * 1.4, false);
      if (ctx.reduced) {
        setOffset(anim, { x: 0, y: 0 });
        return walkStep(ctx, c, 'shift_change', at, { x: 0, y: 0 }, REDUCED_MS, [{ opacity: 0 }, { opacity: 1 }]);
      }
      openDoor(ctx, room, ms * 0.6);
      setOffset(anim, at, 0);
      return walkStep(ctx, c, 'shift_change', at, { x: 0, y: 0 }, ms, [{ transform: tr(at), opacity: 0 }, { transform: tr(at), opacity: 1, offset: 0.2 }, { transform: 'translate(0px, 0px)', opacity: 1 }]);
    }
  }
  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Position (room-local feet), scale and wrapper of whoever receives a handoff. */
function receiver(room: SVGGElement, layout: RoomLayout, targetId: string | undefined): (Point & { scale: number; el: SVGGElement | null; anim: SVGGElement | null }) | undefined {
  const id = targetId && targetId !== 'boss' && layout.seats[targetId] ? targetId : 'boss';
  const p = id === 'boss' ? layout.boss : layout.seats[id];
  if (!p) return undefined;
  const el = charEl(room, id);
  return { x: p.x, y: p.y, scale: id === 'boss' ? layout.bossScale : layout.scale, el, anim: el?.querySelector<SVGGElement>(':scope > .anim') ?? null };
}
