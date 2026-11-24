import { describe, it, expect } from 'vitest';
import { Floor } from '../src/scene/floor.js';
import { OfficeStore } from '../src/core/store.js';

describe('Floor.order', () => {
  it('a /clear keeps the room in its slot: A, B, C then a clear in A orders A2, B, C', () => {
    const s = new OfficeStore();
    for (const [id, t] of [['A', 0], ['B', 10], ['C', 20]] as const) {
      s.applyHook({ hook_event_name: 'SessionStart', source: 'startup', session_id: id, cwd: '/' + id }, t);
      s.applyHook({ hook_event_name: 'Stop', session_id: id, cwd: '/' + id }, t + 1);
    }
    s.applyHook({ hook_event_name: 'SessionEnd', reason: 'clear', session_id: 'A', cwd: '/A' }, 1000);
    s.applyHook({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'A2', cwd: '/A' }, 1001);
    expect(Floor.order(s.snapshot()).map((x) => x.id)).toEqual(['A2', 'B', 'C']);
  });

  it('falls back to boss.startedAt when floorSince is missing', () => {
    const mk = (id: string, startedAt: number, floorSince?: number) =>
      ({ id, cwd: '/', label: id, status: 'active', boss: { status: 'idle', startedAt, stats: {} }, agents: {}, lastActivity: 0, ...(floorSince === undefined ? {} : { floorSince }) }) as never;
    const order = Floor.order({ sessions: { x: mk('x', 50), y: mk('y', 100, 10), z: mk('z', 30) } });
    expect(order.map((s) => s.id)).toEqual(['y', 'z', 'x']);
  });
});
