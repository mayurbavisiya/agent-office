import { describe, expect, it } from 'vitest';
import { LOOP_AT, OfficeStore, TOOL_STUCK_MS } from '../src/core/store.js';
import type { HookEvent } from '../src/shared/types.js';
import { agentLook, runningKey, toolNote } from '../src/scene/looks.js';
import { panelModel } from '../src/scene/panel.js';

const ev = (o: Partial<HookEvent> & { hook_event_name: string }): HookEvent => ({ session_id: 'S1', cwd: '/work/proj', ...o });
const MIN = 60_000;

function withHelper(): OfficeStore {
  const s = new OfficeStore({ stuckMs: 3 * MIN });
  s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 0);
  s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A1', agent_type: 'general-purpose' }), 10);
  return s;
}
const agent = (s: OfficeStore) => s.snapshot().sessions.S1!.agents.A1!;
const pre = (s: OfficeStore, id: string, tool: string, input: Record<string, unknown>, t: number, agentId: string | null = 'A1') =>
  s.applyHook(ev({ hook_event_name: 'PreToolUse', ...(agentId ? { agent_id: agentId } : {}), tool_name: tool, tool_use_id: id, tool_input: input }), t);
const post = (s: OfficeStore, id: string, tool: string, t: number, name = 'PostToolUse', agentId: string | null = 'A1') =>
  s.applyHook(ev({ hook_event_name: name, ...(agentId ? { agent_id: agentId } : {}), tool_name: tool, tool_use_id: id }), t);

describe('a long tool call is busy, not stuck', () => {
  it('a subagent in the middle of a 5-minute Bash stays working, with the call on show', () => {
    const s = withHelper();
    pre(s, 'b1', 'Bash', { command: 'npm test' }, 100);
    s.tick(100 + 5 * MIN);
    expect(agent(s).status).toBe('working');
    expect(agent(s).tool).toEqual({ name: 'Bash', since: 100 });
    post(s, 'b1', 'Bash', 100 + 5 * MIN + 1);
    expect(agent(s).tool).toBeUndefined();
  });
  it('a failed call closes it too (PostToolUseFailure)', () => {
    const s = withHelper();
    pre(s, 'b1', 'Bash', { command: 'false' }, 100);
    post(s, 'b1', 'Bash', 200, 'PostToolUseFailure');
    expect(agent(s).tool).toBeUndefined();
    s.tick(200 + 3 * MIN);
    expect(agent(s).status).toBe('quiet');
  });
  it('a call that never returns does count as maybe stuck after TOOL_STUCK_MS', () => {
    const s = withHelper();
    pre(s, 'b1', 'Bash', { command: 'hang' }, 100);
    s.tick(100 + TOOL_STUCK_MS - 1);
    expect(agent(s).status).toBe('working');
    s.tick(100 + TOOL_STUCK_MS);
    expect(agent(s).status).toBe('quiet');
  });
  it('a call that launches a subagent is not a "running" note (the subagent shows its own work)', () => {
    const s = withHelper();
    pre(s, 'a1', 'Agent', { description: 'x', subagent_type: 'Explore', prompt: 'x' }, 100, null);
    expect(s.snapshot().sessions.S1!.boss.tool).toBeUndefined();
  });
  it('the main agent shows its long call too, and a stop clears it', () => {
    const s = withHelper();
    pre(s, 'm1', 'Bash', { command: 'make' }, 100, null);
    expect(s.snapshot().sessions.S1!.boss.tool).toEqual({ name: 'Bash', since: 100 });
    s.applyHook(ev({ hook_event_name: 'Stop' }), 200);
    expect(s.snapshot().sessions.S1!.boss.tool).toBeUndefined();
  });
});

describe('the same call over and over: looping?', () => {
  it(`${LOOP_AT} identical calls in a row flag it; a different call clears it`, () => {
    const s = withHelper();
    for (let i = 0; i < LOOP_AT - 1; i++) {
      pre(s, `r${i}`, 'Read', { file_path: '/a.ts' }, 100 + i * 10);
      post(s, `r${i}`, 'Read', 105 + i * 10);
    }
    expect(agent(s).looping).toBeUndefined();
    pre(s, 'r9', 'Read', { file_path: '/a.ts' }, 200);
    expect(agent(s).looping).toEqual({ tool: 'Read', count: LOOP_AT });
    pre(s, 'r10', 'Read', { file_path: '/a.ts' }, 210);
    expect(agent(s).looping).toEqual({ tool: 'Read', count: LOOP_AT + 1 });
    pre(s, 'g1', 'Grep', { pattern: 'x' }, 220);
    expect(agent(s).looping).toBeUndefined();
  });
  it('same tool with different input is not a loop', () => {
    const s = withHelper();
    for (let i = 0; i < 5; i++) pre(s, `r${i}`, 'Read', { file_path: `/f${i}.ts` }, 100 + i);
    expect(agent(s).looping).toBeUndefined();
  });
  it('polling tools may repeat freely', () => {
    const s = withHelper();
    for (let i = 0; i < 6; i++) pre(s, `o${i}`, 'TaskOutput', { task_id: 'x' }, 100 + i);
    expect(agent(s).looping).toBeUndefined();
  });
  it('the flag goes when the subagent finishes', () => {
    const s = withHelper();
    for (let i = 0; i < LOOP_AT; i++) pre(s, `r${i}`, 'Read', { file_path: '/a.ts' }, 100 + i);
    s.applyHook(ev({ hook_event_name: 'SubagentStop', agent_id: 'A1' }), 200);
    expect(agent(s).looping).toBeUndefined();
    expect(agent(s).tool).toBeUndefined();
  });
});

describe('how the office shows it', () => {
  it('name tag notes: looping wins; running only after 30s, with a live timer', () => {
    expect(toolNote({ tool: { name: 'Bash', since: 0 } }, 29_999)).toBeUndefined();
    expect(toolNote({ tool: { name: 'Bash', since: 0 } }, 30_000)).toEqual({ text: '⏳ running Bash · {t}', since: 0, kind: 'running' });
    expect(toolNote({ tool: { name: 'Read', since: 0 }, looping: { tool: 'Read', count: 4 } }, 60_000)).toEqual({ text: '↻ looping? Read ×4', kind: 'looping' });
  });
  it('looping gets the loop bubble; waiting on you still wins', () => {
    expect(agentLook('working', false, true)).toMatchObject({ fx: 'loop', mood: 'worried' });
    expect(agentLook('working', true, true)).toMatchObject({ fx: 'alert', pose: 'raise_hand' });
    expect(agentLook('handing_off', false, true).fx).toBe('none');
  });
  it('runningKey changes when a call crosses the 30s mark (so the scene redraws)', () => {
    const state = { sessions: { S1: { id: 'S1', boss: {}, agents: { A1: { id: 'A1', tool: { since: 0 } } } } } };
    expect(runningKey(state, 10_000)).toBe('');
    expect(runningKey(state, 31_000)).toBe('S1/A1');
  });
  it('the details panel says it in words', () => {
    const s = withHelper();
    pre(s, 'b1', 'Bash', { command: 'npm test' }, 100);
    const m = panelModel({ session: s.snapshot().sessions.S1!, agentId: 'A1' }, 100 + 4 * MIN);
    expect(m?.statusLabel).toBe('Running Bash · 4m 00s (busy, not stuck)');
    for (let i = 0; i < 3; i++) pre(s, `r${i}`, 'Read', { file_path: '/a.ts' }, 200 + i);
    expect(panelModel({ session: s.snapshot().sessions.S1!, agentId: 'A1' }, 300)?.statusLabel).toBe('Looping? Same Read call 3× in a row');
  });
});
