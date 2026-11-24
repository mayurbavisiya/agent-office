// Pure, DOM-free geometry for the office floor and room interiors (tested under node).
import type { Agent, Session } from '../shared/types.js';
import { truncate } from './looks.js';

/** The room's title: the registry session name when known, else the folder label. */
export function roomTitle(s: Pick<Session, 'label' | 'name'>): string {
  return s.name || s.label;
}

/** Sign text parts (title · subLabel ⎇ branch), cut to fit a room `roomW` wide next to `count`. */
export function signText(s: Pick<Session, 'label' | 'name' | 'subLabel' | 'branch'>, roomW: number, count: string): { label: string; sub: string; branch: string } {
  const maxChars = Math.max(10, Math.floor((roomW - 40) / 6.6) - count.length);
  let label = roomTitle(s);
  let sub = s.subLabel ? ` · ${s.subLabel}` : '';
  let branch = s.branch ? `  ⎇ ${s.branch}` : '';
  if (label.length + sub.length + branch.length > maxChars) {
    label = truncate(label, Math.max(8, Math.floor(maxChars * 0.45)));
    const rest = maxChars - label.length;
    sub = sub ? truncate(sub, Math.max(6, Math.floor(rest * 0.45))) : '';
    branch = branch ? truncate(branch, Math.max(6, rest - sub.length)) : '';
  }
  return { label, sub, branch };
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Seat = Point & { depth: number };

export const MIN_ROOM_W = 320;
export const MIN_ROOM_H = 220;
/** gap between rooms and around the floor edge */
export const ROOM_GAP = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Grid of n rooms for a floor of the given viewport size. Rooms never go below
 * MIN_ROOM_W x MIN_ROOM_H; when they don't fit, the returned rects extend past
 * the viewport and the floor scrolls. Up to 3 rooms share one row when the width allows.
 */
export function layoutRooms(n: number, width: number, height: number): Rect[] {
  if (n <= 0) return [];
  const g = ROOM_GAP;
  width = Math.max(1, width);
  height = Math.max(1, height);
  const maxCols = Math.max(1, Math.floor((width - g) / (MIN_ROOM_W + g)));
  const squareish = Math.max(1, Math.round(Math.sqrt((n * width) / height / 1.45)));
  const cols = Math.min(maxCols, n, n <= 3 ? n : squareish);
  const rows = Math.ceil(n / cols);
  const w = Math.max(MIN_ROOM_W, Math.floor((width - g * (cols + 1)) / cols));
  const fitH = Math.floor((height - g * (rows + 1)) / rows);
  const h = Math.max(MIN_ROOM_H, Math.min(fitH, Math.round(w * 0.9)));
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({ x: g + c * (w + g), y: g + r * (h + g), w, h });
  }
  return out;
}

export type RoomLayout = {
  rect: Rect;
  /** height of the back wall; the floor starts below it */
  wallH: number;
  /** width of the boss's glass corner */
  bossW: number;
  /** body scale of the boss figure */
  bossScale: number;
  /** body scale of agent figures and desks */
  scale: number;
  /** horizontal pitch between desks (px) */
  slotW: number;
  /** max characters of task text that fit under a name tag */
  taskChars: number;
  /** boss figure position (feet), room-local */
  boss: Point;
  /** door rectangle on the back wall, room-local */
  doorRect: Rect;
  /** where characters enter/leave (in front of the door), room-local */
  door: Point;
  /** desk-seat (feet) position per visible agent id, room-local */
  seats: Record<string, Seat>;
  /** visible agent ids in seating order (parents followed by their helpers) */
  order: string[];
  /** desk slot index per visible agent id; pass it back to the next roomLayout call to keep seats sticky */
  slots: Record<string, number>;
  /** too many agents for clean desks: the grid is squeezed and desks overlap */
  crowded: boolean;
};

export const SIGN_H = 22;
/** px height of a name tag stack (pill + task + tokens) above the head */
export const TAG_H = 36;
/** head top in body units (crown/hat included), feet at 0 */
export const HEAD_TOP = 58;
/** lowest furniture point in body units below the feet line (desk legs and chair base end at the feet; wheels and shoes peek a little lower) */
export const DESK_BOTTOM = 4;
/** body scale limits: crowded rooms shrink figures to MIN_SCALE, roomy ones grow them up to MAX_SCALE */
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 1.6;
/** a workstation (figure + desk) spans [-21, 84] body units horizontally */
const WS_LEFT = 21;
const WS_RIGHT = 84;

/** Visible agents in seating order: depth-first by start time, so helpers sit right after their parent. */
function seatingOrder(session: Session): { id: string; depth: number; parent: string | null }[] {
  const visible = Object.values(session.agents).filter((a) => a.status !== 'gone');
  const ids = new Set(visible.map((a) => a.id));
  const byStart = (a: Agent, b: Agent) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1);
  const kids = new Map<string | null, Agent[]>();
  for (const a of visible) {
    const p = a.parentId && ids.has(a.parentId) && a.parentId !== a.id ? a.parentId : null;
    const list = kids.get(p) ?? [];
    list.push(a);
    kids.set(p, list);
  }
  const out: { id: string; depth: number; parent: string | null }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const a of (kids.get(parent) ?? []).sort(byStart)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ id: a.id, depth, parent });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // parent cycles (shouldn't happen) leave agents unreached; seat them top-level
  for (const a of visible.sort(byStart)) if (!seen.has(a.id)) out.push({ id: a.id, depth: 0, parent: null });
  return out;
}

export type SeatOpts = {
  /** parent agent id per agent (helpers cluster around their parent) */
  parentOf?: Record<string, string | null | undefined>;
  /** grid columns, for the distance between slots (row-major: slot i is at column i % cols) */
  cols?: number;
};

/**
 * Sticky desk assignment. Agents in `prev` that are still in `order` keep their slot; agents
 * missing from `order` free theirs. New agents are taken in `order`: a helper whose parent has a
 * slot gets the free slot nearest the parent's (grid distance, ties to the lower index); anyone
 * else gets the lowest free slot.
 */
export function assignSeats(order: string[], prev: Record<string, number> = {}, opts: SeatOpts = {}): Record<string, number> {
  const cols = Math.max(1, Math.floor(opts.cols ?? 1));
  const out: Record<string, number> = {};
  const taken = new Set<number>();
  for (const id of order) {
    const s = prev[id];
    if (Number.isInteger(s) && s >= 0 && !taken.has(s)) {
      out[id] = s;
      taken.add(s);
    }
  }
  let next = 0;
  for (const id of order) {
    if (id in out) continue;
    const parent = opts.parentOf?.[id];
    const ps = parent != null ? out[parent] : undefined;
    let slot: number;
    if (ps !== undefined) {
      // candidates: every free slot up to one full row past the furthest taken one
      const limit = Math.max(ps, ...taken) + cols + 1;
      const pr = Math.floor(ps / cols);
      const pc = ps % cols;
      slot = -1;
      let best = Infinity;
      for (let i = 0; i <= limit; i++) {
        if (taken.has(i)) continue;
        const d = (Math.floor(i / cols) - pr) ** 2 + ((i % cols) - pc) ** 2;
        if (d < best) {
          best = d;
          slot = i;
        }
      }
    } else {
      while (taken.has(next)) next++;
      slot = next;
    }
    out[id] = slot;
    taken.add(slot);
  }
  return out;
}

/**
 * Sessions that get a room on the floor: all of them, except ended sessions whose fade-out has
 * finished (`faded`) and, when `existing` (ids that have a room now) is given, ended sessions with
 * no room: those were already ended when the page loaded or reconnected, so they count as faded.
 * A session that ends while its room is on screen keeps it until its fade-out completes. Any
 * session that becomes active again gets its room back.
 */
export function visibleSessions<S extends Pick<Session, 'id' | 'status'>>(sessions: S[], faded: ReadonlySet<string>, existing?: ReadonlySet<string>): S[] {
  return sessions.filter((s) => s.status !== 'ended' || (!faded.has(s.id) && (!existing || existing.has(s.id))));
}

/**
 * Interior geometry of one room: boss corner, door, and a desk per visible agent.
 * Pass the previous layout's `slots` as prevSlots to keep agents at their desks across snapshots
 * (see assignSeats); without it, desks are assigned in seating order.
 */
export function roomLayout(session: Session, rect: Rect, prevSlots?: Record<string, number>): RoomLayout {
  const { w, h } = rect;
  const wallH = Math.round(h * 0.34);
  // big rooms get bigger figures (up to MAX_SCALE); crowded rooms shrink them down to MIN_SCALE
  const sMax = Math.round(clamp(Math.min(w / 560, h / 330), 0.7, MAX_SCALE) * 20) / 20;
  const bossW = clamp(Math.round(w * 0.28), 96, 240);
  // the boss grows with the room, but its desk stays inside the glass corner and its tag under the sign
  const bossFloorY = wallH + (h - wallH) * 0.55;
  const bossScale = Math.min(
    clamp(bossW / 170, 0.5, 1) * Math.max(1, sMax),
    (bossW * 0.64 - 4) / WS_RIGHT,
    Math.max(0.5, (bossFloorY - SIGN_H - 12 - TAG_H) / HEAD_TOP),
  );
  const dw = clamp(Math.round(h * 0.17), 34, 54);
  const dh = Math.round(dw * 1.6);
  const doorRect = { x: w - dw - 12, y: Math.max(SIGN_H + 10, wallH - dh), w: dw, h: Math.min(dh, wallH - SIGN_H - 10) };
  const door = { x: doorRect.x + dw / 2, y: Math.min(h - 10, wallH + 16) };

  const order = seatingOrder(session);
  const ids = order.map((o) => o.id);
  const parentOf = Object.fromEntries(order.map((o) => [o.id, o.parent]));
  const x0 = bossW + 12;
  const x1 = w - 10;
  const aw = x1 - x0;

  const fit = (cells: number) => {
    let g = { scale: sMax, cols: 1, rows: 1, slotW: 0, slotH: 0, yMin: 0, yMax: 0 };
    for (let s = sMax; s >= MIN_SCALE - 1e-9; s -= 0.05) {
      const scale = Math.round(s * 100) / 100;
      const slotW = Math.max(115 * scale, 92);
      const slotH = 94 * scale + TAG_H + 8;
      const yMin = Math.max(wallH + 6, 6 + SIGN_H + 6 + TAG_H + HEAD_TOP * scale);
      const yMax = h - DESK_BOTTOM * scale - 6;
      const cols = Math.max(1, Math.floor(aw / slotW));
      const rows = yMax >= yMin ? Math.floor((yMax - yMin) / slotH) + 1 : 1;
      g = { scale, cols, rows, slotW, slotH, yMin, yMax };
      // a scale fits when every cell gets a desk, one workstation fits across and one row fits down
      if (cols * rows >= cells && slotW <= aw && yMax >= yMin) break;
    }
    return g;
  };
  // grid cells needed: up to the highest occupied slot (free desks in between stay put)
  const cellsFor = (sl: Record<string, number>) => (ids.length ? Math.max(...Object.values(sl)) + 1 : 0);
  // helpers' "nearest free slot" needs the column count, which depends on the cell count: assign
  // with an estimate, and once more if the final grid has a different number of columns
  const est = fit(ids.length);
  let slots = assignSeats(ids, prevSlots, { parentOf, cols: est.cols });
  let g = fit(cellsFor(slots));
  if (g.cols !== est.cols) {
    slots = assignSeats(ids, prevSlots, { parentOf, cols: g.cols });
    g = fit(cellsFor(slots));
  }
  const n = cellsFor(slots);
  const { scale, yMin, yMax } = g;
  let { cols, rows, slotW, slotH } = g;
  const seats: Record<string, Seat> = {};
  const crowded = cols * rows < n;
  if (!crowded) {
    // columns fill left to right from a grid centred on all columns, so adding or removing an
    // agent never shifts the others sideways; rows are centred vertically by how many are in use
    const usedRows = Math.max(1, Math.min(rows, Math.ceil(n / cols)));
    const gx = x0 + Math.max(0, aw - cols * slotW) / 2;
    const gy = yMin + Math.max(0, yMax - yMin - (usedRows - 1) * slotH) / 2;
    const mid = ((WS_RIGHT - WS_LEFT) / 2) * scale;
    order.forEach(({ id, depth }) => {
      const i = slots[id];
      const c = i % cols;
      const r = Math.floor(i / cols);
      seats[id] = { x: Math.round(gx + c * slotW + slotW / 2 - mid), y: Math.round(gy + r * slotH), depth };
    });
  } else {
    // crowded: squeeze the grid (desks overlap) but keep every workstation inside the room
    const spanY = Math.max(0, yMax - yMin);
    while (cols * rows < n) {
      const pitchX = aw / (cols + 1) / 115;
      const pitchY = spanY / rows / 94;
      if (pitchX >= pitchY) cols++;
      else rows++;
    }
    const left = x0 + WS_LEFT * scale;
    const right = x1 - WS_RIGHT * scale;
    slotW = cols > 1 ? (right - left) / (cols - 1) : aw;
    slotH = rows > 1 ? spanY / (rows - 1) : slotH;
    order.forEach(({ id, depth }) => {
      const i = slots[id];
      const c = i % cols;
      const r = Math.floor(i / cols);
      seats[id] = { x: Math.round(left + c * (cols > 1 ? slotW : 0)), y: Math.round(yMin + r * (rows > 1 ? slotH : 0)), depth };
    });
  }

  const boss = {
    x: Math.round(bossW * 0.36),
    y: Math.round(Math.min(h - DESK_BOTTOM * bossScale - 8, wallH + (h - wallH) * 0.55)),
  };
  // crowded rooms drop the task line rather than overlap neighbours' tags with it
  const taskChars = slotW < 70 ? 0 : clamp(Math.floor((slotW - 6) / 5), 12, 28);
  return { rect, wallH, bossW, bossScale, scale, slotW, taskChars, boss, doorRect, door, seats, order: order.map((o) => o.id), slots, crowded };
}

/** Current resting position of a character ('boss' or an agent id), room-local. */
export function characterPosition(layout: RoomLayout, agentId: string): Point | undefined {
  if (agentId === 'boss') return layout.boss;
  return layout.seats[agentId];
}

/** Where a finishing agent walks to hand off: beside its parent's desk, or beside the boss. Room-local. */
export function handoffTarget(layout: RoomLayout, agent: Pick<Agent, 'parentId'>): Point {
  const parent = agent.parentId ? layout.seats[agent.parentId] : undefined;
  if (parent) return { x: parent.x + 90 * layout.scale, y: parent.y };
  return { x: layout.boss.x + 90 * layout.bossScale, y: layout.boss.y };
}

/** Convert a room-local point to floor (SVG root) coordinates. */
export function toFloor(rect: Rect, p: Point): Point {
  return { x: rect.x + p.x, y: rect.y + p.y };
}
