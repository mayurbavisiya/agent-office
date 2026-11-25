import { describe, expect, it } from 'vitest';
import { HANDOFF_MS, OfficeStore, PARTY_MAX } from '../src/core/store.js';
import type { HookEvent, OfficeEvent } from '../src/shared/types.js';

const ev = (o: Partial<HookEvent> & { hook_event_name: string }): HookEvent => ({ session_id: 'S1', cwd: '/work/proj', ...o });
const parties = (out: OfficeEvent[]) => out.filter((e) => e.kind === 'party');

function store(): OfficeStore {
  const s = new OfficeStore({ stuckMs: 180_000 });
  s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
  s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 10);
  return s;
}
const spawn = (s: OfficeStore, id: string, type: string, t: number) => s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: type }), t);
const finish = (s: OfficeStore, id: string, t: number) => s.applyHook(ev({ hook_event_name: 'SubagentStop', agent_id: id }), t);

describe('the end-of-task party', () => {
  it('when the lead stops with nobody still working, the subagents of that task come back', () => {
    const s = store();
    spawn(s, 'A1', 'Explore', 20);
    spawn(s, 'A2', 'Plan', 30);
    expect(parties(finish(s, 'A1', 40))).toEqual([]);
    expect(parties(finish(s, 'A2', 50))).toEqual([]);
    expect(parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 60))).toEqual([
      { kind: 'party', sessionId: 'S1', crew: [{ id: 'A1', type: 'Explore' }, { id: 'A2', type: 'Plan' }] },
    ]);
  });

  it('no subagents, no party: a plain turn ends quietly', () => {
    const s = store();
    expect(parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 60))).toEqual([]);
  });

  it('waits for background subagents: the party starts when the last one finishes', () => {
    const s = store();
    spawn(s, 'A1', 'Explore', 20);
    expect(parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 30))).toEqual([]);
    expect(s.snapshot().sessions.S1!.boss.status).toBe('waiting_on_team');
    expect(parties(finish(s, 'A1', 40)).map((p) => p.kind === 'party' && p.crew.map((g) => g.id))).toEqual([['A1']]);
  });

  it('each task throws its own party, and the crew does not carry over', () => {
    const s = store();
    spawn(s, 'A1', 'Explore', 20);
    finish(s, 'A1', 30);
    s.applyHook(ev({ hook_event_name: 'Stop' }), 40);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'next' }), 50);
    expect(parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 60))).toEqual([]);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'more' }), 70);
    spawn(s, 'B1', 'Plan', 80);
    finish(s, 'B1', 90);
    const p = parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 100));
    expect(p.map((e) => e.kind === 'party' && e.crew.map((g) => g.id))).toEqual([['B1']]);
  });

  it('invites at most PARTY_MAX guests (the most recent ones)', () => {
    const s = store();
    for (let i = 0; i < PARTY_MAX + 3; i++) {
      spawn(s, `A${i}`, 'Explore', 20 + i);
      finish(s, `A${i}`, 40 + i);
    }
    const [p] = parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 100));
    expect(p?.kind === 'party' && p.crew.map((g) => g.id)).toEqual(Array.from({ length: PARTY_MAX }, (_, i) => `A${i + 3}`));
  });

  it('still parties after the crew has left the room', () => {
    const s = store();
    spawn(s, 'A1', 'Explore', 20);
    finish(s, 'A1', 30);
    s.tick(30 + HANDOFF_MS + 10);
    expect(parties(s.applyHook(ev({ hook_event_name: 'Stop' }), 30 + HANDOFF_MS + 20))).toHaveLength(1);
  });
});
