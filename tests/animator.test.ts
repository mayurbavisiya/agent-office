import { describe, it, expect, vi, afterEach } from 'vitest';
import { planAnimations, partySpots, DURATIONS, tween, cancelAnimation, stepClasses, facing, walkStep } from '../src/scene/animator.js';
import type { Agent, OfficeState, Session } from '../src/shared/types.js';

const stats = () => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0 });
function agent(id: string, parentId: string | null, status: Agent['status'] = 'working', sessionId = 's1'): Agent {
  return { id, sessionId, parentId, type: 'Explore', status, startedAt: 1, stats: stats() };
}
function session(id: string, agents: Agent[] = [], status: Session['status'] = 'active'): Session {
  return {
    id, cwd: '/x/proj', label: 'proj', status, lastActivity: 0,
    boss: { status: 'working', startedAt: 0, stats: stats() },
    agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  };
}
const state = (...sessions: Session[]): OfficeState => ({ sessions: Object.fromEntries(sessions.map((s) => [s.id, s])) });

describe('planAnimations', () => {
  it('uses the brief durations', () => {
    expect(DURATIONS).toMatchObject({ enter_door: 1200, walk_to_desk: 2000, walk_to: 2000, give: 800, celebrate: 1200, party: 3600, exit_door: 2000 });
  });

  it('spawned → [enter_door 1200, walk_to_desk 2000]', () => {
    const st = state(session('s1', [agent('a1', null, 'spawning')]));
    expect(planAnimations([{ kind: 'spawned', sessionId: 's1', agentId: 'a1' }], st)).toEqual([
      { agentId: 'a1', sessionId: 's1', kind: 'enter_door', durationMs: 1200 },
      { agentId: 'a1', sessionId: 's1', kind: 'walk_to_desk', durationMs: 2000 },
    ]);
  });

  it('handoff to boss → [walk_to boss 2000, give 800, celebrate(boss) 1200], then left → [exit_door 2000]', () => {
    const st = state(session('s1', [agent('a1', null, 'handing_off')]));
    expect(planAnimations([{ kind: 'handoff', sessionId: 's1', agentId: 'a1', toId: 'boss' }], st)).toEqual([
      { agentId: 'a1', sessionId: 's1', kind: 'walk_to', targetId: 'boss', durationMs: 2000 },
      { agentId: 'a1', sessionId: 's1', kind: 'give', targetId: 'boss', durationMs: 800 },
      { agentId: 'a1', sessionId: 's1', kind: 'celebrate', targetId: 'boss', durationMs: 1200 },
    ]);
    const gone = state(session('s1', [agent('a1', null, 'gone')]));
    expect(planAnimations([{ kind: 'left', sessionId: 's1', agentId: 'a1' }], gone)).toEqual([
      { agentId: 'a1', sessionId: 's1', kind: 'exit_door', durationMs: 2000 },
    ]);
  });

  it('handoff to parent agent → walk_to that agent, not boss', () => {
    const st = state(session('s1', [agent('p1', null), agent('c1', 'p1', 'handing_off')]));
    const steps = planAnimations([{ kind: 'handoff', sessionId: 's1', agentId: 'c1', toId: 'p1' }], st);
    expect(steps[0]).toEqual({ agentId: 'c1', sessionId: 's1', kind: 'walk_to', targetId: 'p1', durationMs: 2000 });
    expect(steps.every((s) => s.targetId === 'p1')).toBe(true);
  });

  it('shift_change → one shift_change step', () => {
    const st = state(session('s2'));
    const steps = planAnimations([{ kind: 'shift_change', fromSessionId: 's1', toSessionId: 's2' }], st);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'shift_change', sessionId: 's2', agentId: 'boss', targetId: 's1' });
    expect(steps[0].durationMs).toBeGreaterThan(0);
  });

  it('session_started/ended → fade_in_room / fade_out_room', () => {
    const st = state(session('s1'), session('s2', [], 'ended'));
    const steps = planAnimations(
      [
        { kind: 'session_started', sessionId: 's1' },
        { kind: 'session_ended', sessionId: 's2' },
      ],
      st,
    );
    expect(steps.map((s) => [s.kind, s.sessionId])).toEqual([
      ['fade_in_room', 's1'],
      ['fade_out_room', 's2'],
    ]);
    expect(steps.every((s) => s.durationMs > 0)).toBe(true);
  });

  it('shift_change cancels a pending fade_out_room for the same room', () => {
    const st = state(session('s2'), session('s3', [], 'ended'));
    const steps = planAnimations(
      [
        { kind: 'session_ended', sessionId: 's1' },
        { kind: 'session_ended', sessionId: 's3' },
        { kind: 'shift_change', fromSessionId: 's1', toSessionId: 's2' },
      ],
      st,
    );
    expect(steps.map((s) => [s.kind, s.sessionId])).toEqual([
      ['fade_out_room', 's3'],
      ['shift_change', 's2'],
    ]);
  });

  it('keeps per-agent step order across events in one batch (spawn walk before handoff)', () => {
    const st = state(session('s1', [agent('a1', null, 'handing_off')]));
    const steps = planAnimations(
      [
        { kind: 'spawned', sessionId: 's1', agentId: 'a1' },
        { kind: 'handoff', sessionId: 's1', agentId: 'a1', toId: 'boss' },
      ],
      st,
    );
    expect(steps.map((s) => s.kind)).toEqual(['enter_door', 'walk_to_desk', 'walk_to', 'give', 'celebrate']);
  });
});

describe('tween (Web Animations runner)', () => {
  afterEach(() => vi.useRealTimers());

  /** An element whose animations never finish: a hidden tab / throttled webview stalls the timeline. */
  function stalled() {
    const anim = { finished: new Promise<never>(() => {}), playState: 'running', cancel: vi.fn() };
    const el = { animate: vi.fn(() => anim), style: {} as Record<string, string> };
    return { anim, el };
  }

  it('commits the last keyframe when the timeline stalls and the safety timeout fires', async () => {
    vi.useFakeTimers();
    const { anim, el } = stalled();
    const running = new Set<Animation>();
    const p = tween({ q: { running }, reduced: false }, el as unknown as Element, [
      { transform: 'translate(300px, -80px)', opacity: 0 },
      { transform: 'translate(0px, 0px)', opacity: 1 },
    ], 2000);
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toBe(true);
    expect(el.style.transform).toBe('translate(0px, 0px)');
    expect(el.style.opacity).toBe('1');
    expect(anim.cancel).toHaveBeenCalled();
    expect(running.size).toBe(0);
  });

  it('discards the end state after an explicit cancel', async () => {
    vi.useFakeTimers();
    const { anim, el } = stalled();
    el.style.opacity = '1';
    const running = new Set<Animation>();
    const p = tween({ q: { running }, reduced: false }, el as unknown as Element, [{ opacity: 1 }, { opacity: 0 }], 600);
    cancelAnimation(anim as unknown as Animation);
    await vi.advanceTimersByTimeAsync(1700);
    await expect(p).resolves.toBe(false);
    expect(el.style.opacity).toBe('1');
  });
});

describe('walk choreography', () => {
  afterEach(() => vi.useRealTimers());

  it('stepClasses maps each walk kind', () => {
    expect(stepClasses('enter_door')).toEqual({ add: ['walking'], remove: ['sitting'] });
    expect(stepClasses('walk_to_desk')).toEqual({ add: ['walking'], remove: ['sitting'] });
    expect(stepClasses('walk_to')).toEqual({ add: ['walking', 'carrying'], remove: ['sitting'] });
    expect(stepClasses('give')).toEqual({ add: ['giving'], remove: ['walking', 'carrying'] });
    expect(stepClasses('exit_door')).toEqual({ add: ['walking'], remove: ['giving', 'carrying', 'sitting', 'dancing'] });
    expect(stepClasses('celebrate')).toEqual({ add: [], remove: [] });
    expect(stepClasses('party')).toEqual({ add: ['walking'], remove: ['sitting', 'carrying', 'giving', 'dancing'] });
  });

  it('facing turns toward travel', () => {
    expect(facing(10, 50, -1)).toBe(1);
    expect(facing(50, 10, 1)).toBe(-1);
    expect(facing(10, 10.5, -1)).toBe(-1);
  });

  /** A g.char stub: real class bookkeeping, a g.dir, and a g.anim whose animations never finish. */
  function stalledChar() {
    const anim = { finished: new Promise<never>(() => {}), playState: 'running', cancel: vi.fn() };
    const animEl = { animate: vi.fn(() => anim), style: {} as Record<string, string> };
    const dir = { style: {} as Record<string, string> };
    const cls = new Set(['sitting', 'pose-type']);
    const c = {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      classList: {
        add: (...n: string[]) => n.forEach((x) => cls.add(x)),
        remove: (...n: string[]) => n.forEach((x) => cls.delete(x)),
        contains: (n: string) => cls.has(n),
        toggle: (n: string, on?: boolean) => ((on ?? !cls.has(n)) ? cls.add(n) : cls.delete(n), cls.has(n)),
      },
      querySelector: (sel: string) => (sel.includes('.dir') ? dir : animEl),
    };
    return { c, cls, dir, animEl };
  }

  it('final classes are committed on a stalled timeline', async () => {
    vi.useFakeTimers();
    const { c, cls, dir } = stalledChar();
    const running = new Set<Animation>();
    const p = walkStep({ q: { running }, reduced: false }, c as unknown as SVGGElement, 'walk_to_desk', { x: 200, y: -40 }, { x: 0, y: 0 }, 2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(cls.has('walking')).toBe(true);
    expect(cls.has('sitting')).toBe(false);
    expect(dir.style.transform).toBe('scale(-1,1)');
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cls.has('sitting')).toBe(true);
    expect(cls.has('walking')).toBe(false);
    expect(dir.style.transform).toBe('scale(1,1)');
    expect(running.size).toBe(0);
  });
});

describe('the end-of-task party', () => {
  const state = { sessions: { s1: { id: 's1' } } } as never;
  it('a party event becomes one party step on the lead, carrying the crew', () => {
    const crew = [{ id: 'a1', type: 'Explore' }, { id: 'a2', type: 'Plan', name: 'planner' }];
    expect(planAnimations([{ kind: 'party', sessionId: 's1', crew }], state)).toEqual([{ agentId: 'boss', sessionId: 's1', kind: 'party', durationMs: 3600, crew }]);
    expect(planAnimations([{ kind: 'party', sessionId: 'gone', crew }], state)).toEqual([]);
  });
  it('lines everyone up in the middle of the open floor, the lead in the centre', () => {
    const layout = { rect: { x: 0, y: 0, w: 600, h: 300 }, bossW: 160, wallH: 100, scale: 1 };
    const s = partySpots(layout, 2);
    expect(s.lead).toEqual({ x: 380, y: 224 });
    expect(s.guests.map((g) => g.x)).toEqual([324, 436]);
    const many = partySpots(layout, 6);
    for (const p of [many.lead, ...many.guests]) expect(p.x).toBeGreaterThan(160), expect(p.x).toBeLessThan(600);
  });
  it('the hand-off still ends before the tracker marks the agent gone', async () => {
    const { HANDOFF_MS } = await import('../src/core/store.js');
    expect(DURATIONS.walk_to + DURATIONS.give + DURATIONS.celebrate).toBeLessThan(HANDOFF_MS);
  });
});
