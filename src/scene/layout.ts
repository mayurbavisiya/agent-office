// Pure, DOM-free geometry for the office floor and room interiors (tested under node).
import type { Agent, Session } from '../shared/types.js';

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
  /** too many agents for clean desks: the grid is squeezed and desks overlap */
  crowded: boolean;
};

export const SIGN_H = 22;
/** px height of a name tag stack (pill + task + tokens) above the head */
export const TAG_H = 36;
/** head top in body units (crown/hat included), feet at 0 */
export const HEAD_TOP = 58;
/** desk legs bottom in body units, below the feet line */
export const DESK_BOTTOM = 36;
/** a workstation (figure + desk) spans [-21, 84] body units horizontally */
const WS_LEFT = 21;
const WS_RIGHT = 84;

/** Visible agents in seating order: depth-first by start time, so helpers sit right after their parent. */
function seatingOrder(session: Session): { id: string; depth: number }[] {
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
  const out: { id: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const a of (kids.get(parent) ?? []).sort(byStart)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ id: a.id, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // parent cycles (shouldn't happen) leave agents unreached; seat them top-level
  for (const a of visible.sort(byStart)) if (!seen.has(a.id)) out.push({ id: a.id, depth: 0 });
  return out;
}

/** Interior geometry of one room: boss corner, door, and a desk per visible agent. */
export function roomLayout(session: Session, rect: Rect): RoomLayout {
  const { w, h } = rect;
  const wallH = Math.round(h * 0.34);
  const bossW = clamp(Math.round(w * 0.28), 96, 190);
  const bossScale = clamp(bossW / 170, 0.5, 1);
  const dw = clamp(Math.round(h * 0.17), 34, 54);
  const dh = Math.round(dw * 1.6);
  const doorRect = { x: w - dw - 12, y: Math.max(SIGN_H + 10, wallH - dh), w: dw, h: Math.min(dh, wallH - SIGN_H - 10) };
  const door = { x: doorRect.x + dw / 2, y: Math.min(h - 10, wallH + 16) };

  const order = seatingOrder(session);
  const n = order.length;
  const x0 = bossW + 12;
  const x1 = w - 10;
  const aw = x1 - x0;

  // big rooms get bigger figures; crowded rooms shrink them down to 0.4
  const sMax = Math.round(clamp(Math.min(w / 700, h / 400), 0.7, 1) * 20) / 20;
  let scale = sMax;
  let cols = 1;
  let rows = 1;
  let slotW = 0;
  let slotH = 0;
  let yMin = 0;
  let yMax = 0;
  for (let s = sMax; s >= 0.4 - 1e-9; s -= 0.05) {
    scale = Math.round(s * 100) / 100;
    slotW = Math.max(115 * scale, 92);
    slotH = 94 * scale + TAG_H + 8;
    yMin = Math.max(wallH + 6, 6 + SIGN_H + 6 + TAG_H + HEAD_TOP * scale);
    yMax = h - DESK_BOTTOM * scale - 6;
    cols = Math.max(1, Math.floor(aw / slotW));
    rows = yMax >= yMin ? Math.floor((yMax - yMin) / slotH) + 1 : 1;
    if (cols * rows >= n) break;
  }
  const seats: Record<string, Seat> = {};
  const crowded = cols * rows < n;
  if (!crowded) {
    const usedCols = Math.max(1, Math.min(cols, n));
    const usedRows = Math.max(1, Math.min(rows, Math.ceil(n / cols)));
    const gx = x0 + (aw - usedCols * slotW) / 2;
    const gy = yMin + Math.max(0, yMax - yMin - (usedRows - 1) * slotH) / 2;
    const mid = ((WS_RIGHT - WS_LEFT) / 2) * scale;
    order.forEach(({ id, depth }, i) => {
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
    order.forEach(({ id, depth }, i) => {
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
  return { rect, wallH, bossW, bossScale, scale, slotW, taskChars, boss, doorRect, door, seats, order: order.map((o) => o.id), crowded };
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
