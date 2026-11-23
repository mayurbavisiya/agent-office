import { describe, it, expect } from 'vitest';
import { layoutRooms, roomLayout, handoffTarget, assignSeats, visibleSessions, signText, roomTitle, MIN_ROOM_W, MIN_ROOM_H } from '../src/scene/layout.js';
import type { Agent, Session } from '../src/shared/types.js';

const stats = () => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0 });
function agent(id: string, parentId: string | null, startedAt: number, status: Agent['status'] = 'working'): Agent {
  return { id, sessionId: 's1', parentId, type: 'Explore', status, startedAt, stats: stats() };
}
function session(agents: Agent[]): Session {
  return {
    id: 's1', cwd: '/x/proj', label: 'proj', status: 'active', lastActivity: 0,
    boss: { status: 'working', startedAt: 0, stats: stats() },
    agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  };
}

describe('layoutRooms', () => {
  it('uses a 320x220 minimum room size', () => {
    expect(MIN_ROOM_W).toBe(320);
    expect(MIN_ROOM_H).toBe(220);
  });

  it.each([1, 2, 3])('fills the width in one row for %i room(s)', (n) => {
    const rects = layoutRooms(n, 1200, 700);
    expect(rects).toHaveLength(n);
    expect(new Set(rects.map((r) => r.y)).size).toBe(1);
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const left = Math.min(...rects.map((r) => r.x));
    expect(left).toBeLessThan(20);
    expect(right).toBeGreaterThan(1200 - 20);
    expect(right).toBeLessThanOrEqual(1200);
    for (const r of rects) {
      expect(r.w).toBeGreaterThanOrEqual(320);
      expect(r.h).toBeGreaterThanOrEqual(220);
    }
  });

  it('keeps 8 rooms >= 320x220 in 900x500 and grows taller than the viewport (floor scrolls)', () => {
    const rects = layoutRooms(8, 900, 500);
    expect(rects).toHaveLength(8);
    for (const r of rects) {
      expect(r.w).toBeGreaterThanOrEqual(320);
      expect(r.h).toBeGreaterThanOrEqual(220);
      expect(r.x + r.w).toBeLessThanOrEqual(900);
    }
    expect(Math.max(...rects.map((r) => r.y + r.h))).toBeGreaterThan(500);
  });

  it('rooms never overlap', () => {
    const rects = layoutRooms(11, 1000, 600);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it('keeps the minimum width even when the window is narrower (floor scrolls sideways)', () => {
    const [r] = layoutRooms(1, 200, 150);
    expect(r.w).toBe(320);
    expect(r.h).toBe(220);
  });

  it('returns nothing for zero rooms', () => {
    expect(layoutRooms(0, 800, 600)).toEqual([]);
  });
});

describe('roomLayout', () => {
  const rect = { x: 0, y: 0, w: 480, h: 300 };

  it('puts the boss in the left glass corner and the door on the right', () => {
    const l = roomLayout(session([]), rect);
    expect(l.boss.x).toBeLessThan(l.bossW);
    expect(l.door.x).toBeGreaterThan(rect.w * 0.75);
  });

  it('gives every visible agent a seat inside the room, right of the boss corner, without gone agents', () => {
    const agents = [agent('a', null, 1), agent('b', null, 2), agent('c', null, 3), agent('g', null, 4, 'gone')];
    const l = roomLayout(session(agents), rect);
    expect(Object.keys(l.seats).sort()).toEqual(['a', 'b', 'c']);
    for (const p of Object.values(l.seats)) {
      expect(p.x).toBeGreaterThan(l.bossW);
      expect(p.x).toBeLessThan(rect.w);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(rect.h);
    }
    const keys = new Set(Object.values(l.seats).map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(3);
  });

  it('orders seats by start time and seats a child right after its parent', () => {
    const agents = [agent('p1', null, 1), agent('p2', null, 2), agent('k', 'p1', 3), agent('gk', 'k', 4)];
    const l = roomLayout(session(agents), { x: 0, y: 0, w: 900, h: 400 });
    expect(l.order).toEqual(['p1', 'k', 'gk', 'p2']);
    expect(l.seats.k.depth).toBe(1);
    expect(l.seats.gk.depth).toBe(2);
    expect(l.seats.p1.depth).toBe(0);
  });

  it('treats an agent whose parent is missing as top-level', () => {
    const l = roomLayout(session([agent('orphan', 'nope', 1)]), rect);
    expect(l.seats.orphan.depth).toBe(0);
  });

  it('shrinks characters to fit more agents, within limits', () => {
    const few = roomLayout(session([agent('a', null, 1)]), rect);
    const many = roomLayout(session(Array.from({ length: 8 }, (_, i) => agent(`a${i}`, null, i))), rect);
    expect(many.scale).toBeLessThan(few.scale);
    expect(many.scale).toBeGreaterThanOrEqual(0.4);
    expect(Object.keys(many.seats)).toHaveLength(8);
  });

  it('keeps a crowded room (25 agents in 320x220) inside the room with distinct seats', () => {
    const r = { x: 0, y: 0, w: 320, h: 220 };
    const l = roomLayout(session(Array.from({ length: 25 }, (_, i) => agent(`a${i}`, null, i))), r);
    const pts = Object.values(l.seats);
    expect(pts).toHaveLength(25);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(l.bossW);
      expect(p.x + 84 * l.scale).toBeLessThanOrEqual(r.w);
      expect(p.y + 36 * l.scale).toBeLessThanOrEqual(r.h);
      expect(p.y).toBeGreaterThan(l.wallH);
    }
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(25);
    expect(l.crowded).toBe(true);
    expect(roomLayout(session([agent('a', null, 1)]), r).crowded).toBe(false);
  });

  it('seat assignment is sticky when an agent leaves and new agents take the first free slot', () => {
    expect(assignSeats(['a', 'b', 'c'])).toEqual({ a: 0, b: 1, c: 2 });
    expect(assignSeats(['a', 'c'], { a: 0, b: 1, c: 2 })).toEqual({ a: 0, c: 2 });
    expect(assignSeats(['a', 'c', 'd', 'e'], { a: 0, c: 2 })).toEqual({ a: 0, c: 2, d: 1, e: 3 });

    const big = { x: 0, y: 0, w: 900, h: 400 };
    const first = roomLayout(session([agent('a', null, 1), agent('b', null, 2), agent('c', null, 3)]), big);
    const bSeat = first.seats.b;
    // b leaves: a and c stay exactly where they were
    const second = roomLayout(session([agent('a', null, 1), agent('b', null, 2, 'gone'), agent('c', null, 3)]), big, first.slots);
    expect(second.seats.a).toEqual(first.seats.a);
    expect(second.seats.c).toEqual(first.seats.c);
    expect(second.seats.b).toBeUndefined();
    // a new agent takes b's free desk; nobody else moves
    const third = roomLayout(session([agent('a', null, 1), agent('c', null, 3), agent('d', null, 9)]), big, second.slots);
    expect(third.slots.d).toBe(1);
    expect({ x: third.seats.d.x, y: third.seats.d.y }).toEqual({ x: bSeat.x, y: bSeat.y });
    expect(third.seats.a).toEqual(first.seats.a);
    expect(third.seats.c).toEqual(first.seats.c);
  });

  it('a new helper takes the free slot nearest its parent', () => {
    // 3 columns; parent p at slot 5 (row 1, col 2); free: 1, 2, 3, 4, ...
    // h (helper of p) takes 2 (directly above p; ties with 4 go to the lower index), t (top-level) the first free, 1
    expect(assignSeats(['a', 'p', 'h', 't'], { a: 0, p: 5 }, { parentOf: { h: 'p', t: null }, cols: 3 })).toEqual({ a: 0, p: 5, h: 2, t: 1 });
    // a helper whose parent has no slot falls back to the first free slot
    expect(assignSeats(['h'], {}, { parentOf: { h: 'missing' }, cols: 3 })).toEqual({ h: 0 });

    // in a room: a leaves (slot 0 frees up), then p's new helper sits right next to p, not at slot 0
    const big = { x: 0, y: 0, w: 900, h: 400 };
    const first = roomLayout(session([agent('a', null, 1), agent('b', null, 2), agent('p', null, 3)]), big);
    expect(first.slots).toEqual({ a: 0, b: 1, p: 2 });
    const second = roomLayout(session([agent('a', null, 1, 'gone'), agent('b', null, 2), agent('p', null, 3), agent('h', 'p', 4)]), big, first.slots);
    expect(second.slots.h).toBe(3);
    expect(second.seats.h.y).toBe(second.seats.p.y);
    expect(second.seats.h.x - second.seats.p.x).toBeCloseTo(second.slotW, 0);
    expect(second.seats.p).toEqual(first.seats.p);
  });

  it('ended rooms are excluded after their fade-out', () => {
    const s = (id: string, status: 'active' | 'ended') => ({ id, status });
    const all = [s('live', 'active'), s('ending', 'ended'), s('gone', 'ended')];
    // ended but still fading out: keeps its room
    expect(visibleSessions(all, new Set()).map((x) => x.id)).toEqual(['live', 'ending', 'gone']);
    // fade-out done: excluded
    expect(visibleSessions(all, new Set(['gone'])).map((x) => x.id)).toEqual(['live', 'ending']);
    // revived (active again): back on the floor even though it once faded
    expect(visibleSessions([s('gone', 'active')], new Set(['gone'])).map((x) => x.id)).toEqual(['gone']);
  });

  it('ended sessions with no existing room are hidden on initial render', () => {
    const s = (id: string, status: 'active' | 'ended') => ({ id, status });
    const all = [s('live', 'active'), s('oldEnded', 'ended'), s('justEnded', 'ended')];
    // initial snapshot: no rooms yet, so an already-ended session never gets one
    expect(visibleSessions(all, new Set(), new Set()).map((x) => x.id)).toEqual(['live']);
    // a session that ended while its room was on screen keeps it (it still gets its fade-out)
    expect(visibleSessions(all, new Set(), new Set(['live', 'justEnded'])).map((x) => x.id)).toEqual(['live', 'justEnded']);
    // revived: back even without a room
    expect(visibleSessions([s('oldEnded', 'active')], new Set(['oldEnded']), new Set()).map((x) => x.id)).toEqual(['oldEnded']);
  });

  it('handoffTarget walks a child to its parent and a top-level agent to the boss', () => {
    const agents = [agent('p', null, 1), agent('k', 'p', 2)];
    const s = session(agents);
    const l = roomLayout(s, rect);
    const toParent = handoffTarget(l, s.agents.k);
    const toBoss = handoffTarget(l, s.agents.p);
    expect(Math.abs(toParent.y - l.seats.p.y)).toBeLessThan(1);
    expect(toParent.x).toBeGreaterThan(l.seats.p.x);
    expect(Math.abs(toBoss.y - l.boss.y)).toBeLessThan(1);
    expect(toBoss.x).toBeGreaterThan(l.boss.x);
  });
});

describe('room sign', () => {
  it('room label prefers the session name', () => {
    const s = { ...session([]), branch: 'main' };
    expect(roomTitle(s)).toBe('proj');
    expect(signText(s, 600, '')).toEqual({ label: 'proj', sub: '', branch: '  ⎇ main' });
    const named = { ...s, name: 'crm-brainstorm', subLabel: 'abc123' };
    expect(roomTitle(named)).toBe('crm-brainstorm');
    expect(signText(named, 600, '')).toEqual({ label: 'crm-brainstorm', sub: ' · abc123', branch: '  ⎇ main' });
  });

  it('cuts a long sign to the room width', () => {
    const s = { ...session([]), name: 'a-very-long-session-name-that-goes-on', branch: 'feature/some-long-branch-name' };
    const t = signText(s, 320, '  · 2 agents');
    expect(t.label.length + t.sub.length + t.branch.length).toBeLessThanOrEqual(Math.floor((320 - 40) / 6.6) - 12);
    expect(t.branch).toContain('⎇');
  });
});
