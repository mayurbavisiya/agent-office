import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfficeStore } from '../src/core/store.js';
import type { HookEvent, OfficeEvent } from '../src/shared/types.js';

const FIX = join(__dirname, 'fixtures/hooks');
const load = (name: string): HookEvent[] =>
  readFileSync(join(FIX, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as HookEvent);

/** Replays events at t0, t0+step, ...; returns all emitted events and the time of the last one. */
function replay(store: OfficeStore, events: HookEvent[], t0 = 1_000, step = 100): { out: OfficeEvent[]; t: number } {
  const out: OfficeEvent[] = [];
  let t = t0;
  for (const e of events) {
    out.push(...store.applyHook(e, t));
    t += step;
  }
  return { out, t: t - step };
}

/** Index of the first event matching. */
const idx = (events: HookEvent[], pred: (e: HookEvent) => boolean) => {
  const i = events.findIndex(pred);
  if (i < 0) throw new Error('fixture event not found');
  return i;
};

const SINGLE_SID = 'f9e58de5-4a17-4ce3-b430-e3d054dfb702';
const SINGLE_AGENT = 'a1c6ea8b5593d9948';
const NESTED_PARENT = 'a9f22c4a50884571c';
const NESTED_CHILD = 'a77d3c6b5b7d26195';
const BG_AGENT = 'a22a3e7a7ad2a9925';

const ev = (o: Partial<HookEvent> & { hook_event_name: string }): HookEvent => ({ session_id: 'S1', cwd: '/work/proj', ...o });

describe('OfficeStore: sessions', () => {
  it('SessionStart creates session with label = basename(cwd), boss idle', () => {
    const s = new OfficeStore();
    const events = load('single-subagent');
    const out = s.applyHook(events[0], 1_000);
    const sess = s.snapshot().sessions[SINGLE_SID];
    expect(sess).toBeDefined();
    expect(sess.label).toBe('ao');
    expect(sess.cwd).toBe('/scratch/ao');
    expect(sess.status).toBe('active');
    expect(sess.boss.status).toBe('idle');
    expect(sess.subLabel).toBeUndefined();
    expect(out).toEqual([{ kind: 'session_started', sessionId: SINGLE_SID }]);
  });

  it('label is "unknown" when there is no cwd', () => {
    const s = new OfficeStore();
    s.applyHook({ hook_event_name: 'SessionStart', session_id: 'X', source: 'startup' }, 1);
    expect(s.snapshot().sessions.X.label).toBe('unknown');
  });

  it('UserPromptSubmit → boss working', () => {
    const s = new OfficeStore();
    const events = load('single-subagent');
    replay(s, events.slice(0, 2));
    expect(s.snapshot().sessions[SINGLE_SID].boss.status).toBe('working');
  });

  it('SessionEnd → ended + session_ended', () => {
    const s = new OfficeStore();
    const events = load('single-subagent');
    const { out } = replay(s, events);
    expect(s.snapshot().sessions[SINGLE_SID].status).toBe('ended');
    expect(out[out.length - 1]).toEqual({ kind: 'session_ended', sessionId: SINGLE_SID });
  });

  it('30 min no activity → ended', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), 1_000);
    expect(s.tick(1_000 + 1_799_999)).toEqual([]);
    expect(s.snapshot().sessions.S1.status).toBe('active');
    expect(s.tick(1_000 + 1_800_000)).toEqual([{ kind: 'session_ended', sessionId: 'S1' }]);
    expect(s.snapshot().sessions.S1.status).toBe('ended');
  });

  it('endedMs is configurable', () => {
    const s = new OfficeStore({ endedMs: 5_000 });
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    expect(s.tick(5_000)).toEqual([{ kind: 'session_ended', sessionId: 'S1' }]);
  });

  it('resume with the same session_id revives the room, never duplicates it (clear-resume fixture)', () => {
    const s = new OfficeStore();
    const events = load('clear-resume');
    const out: OfficeEvent[] = [];
    let t = 1_000;
    for (const e of events) {
      out.push(...s.applyHook(e, t));
      t += 100;
      if (e.hook_event_name === 'SessionStart' && e.source === 'resume') {
        expect(s.snapshot().sessions[e.session_id].status).toBe('active');
      }
    }
    expect(Object.keys(s.snapshot().sessions)).toHaveLength(1);
    expect(out.filter((o) => o.kind === 'session_ended')).toHaveLength(3);
    expect(out.filter((o) => o.kind === 'session_started')).toHaveLength(3);
    expect(out.some((o) => o.kind === 'shift_change')).toBe(false);
  });

  it('SessionStart source clear in same cwd as an idle session → takes over room, emits shift_change, no second room', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), 100);
    s.applyHook(ev({ hook_event_name: 'Stop' }), 200);
    expect(s.snapshot().sessions.S1.boss.status).toBe('idle');
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 300);
    expect(out).toEqual([{ kind: 'shift_change', fromSessionId: 'S1', toSessionId: 'S2' }]);
    const sessions = s.snapshot().sessions;
    expect(Object.keys(sessions)).toEqual(['S2']);
    expect(sessions.S2.label).toBe('proj');
    expect(sessions.S2.status).toBe('active');
    expect(sessions.S2.boss.status).toBe('idle');
  });

  it('SessionStart source clear after the old session ended (SessionEnd reason clear) also takes over', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'SessionEnd', reason: 'clear' }), 100);
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 200);
    expect(out).toEqual([{ kind: 'shift_change', fromSessionId: 'S1', toSessionId: 'S2' }]);
    expect(Object.keys(s.snapshot().sessions)).toEqual(['S2']);
  });

  it('takeover then late events for the old id (Start(clear) before End(clear), late Stop) → one room, no session_started for the old id', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), 100);
    s.applyHook(ev({ hook_event_name: 'Stop' }), 200);
    const out: OfficeEvent[] = [];
    out.push(...s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 300));
    out.push(...s.applyHook(ev({ hook_event_name: 'SessionEnd', reason: 'clear' }), 310));
    out.push(...s.applyHook(ev({ hook_event_name: 'Stop' }), 320));
    s.applyLog('S1', null, { toolUses: [], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }, 330);
    expect(out).toEqual([{ kind: 'shift_change', fromSessionId: 'S1', toSessionId: 'S2' }]);
    const ss = s.snapshot().sessions;
    expect(Object.keys(ss)).toEqual(['S2']);
    expect(ss.S2.status).toBe('active');
    expect(ss.S2.boss.status).toBe('idle');
    expect(ss.S2.boss.stats.outputTokens).toBe(0);
  });

  it('a replaced session id that is explicitly resumed later gets a room again', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 100);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', session_id: 'S2', prompt: 'busy' }), 200);
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'resume', cwd: '/work/other' }), 300);
    expect(out).toEqual([{ kind: 'session_started', sessionId: 'S1' }]);
    expect(Object.keys(s.snapshot().sessions).sort()).toEqual(['S1', 'S2']);
  });

  it('SessionStart source resume with a new id in same cwd as a quiet (idle) session takes over', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'resume' }), 200);
    expect(out).toEqual([{ kind: 'shift_change', fromSessionId: 'S1', toSessionId: 'S2' }]);
  });

  it('clear does not take over a busy room (boss working) or one in another folder', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), 0);
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'OTHER', cwd: '/work/other', source: 'startup' }), 0);
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 100);
    expect(out).toEqual([{ kind: 'session_started', sessionId: 'S2' }]);
    expect(Object.keys(s.snapshot().sessions).sort()).toEqual(['OTHER', 'S1', 'S2']);
  });

  it('startup in the same cwd never takes over; two live sessions same cwd → both have subLabel (session_title or first 6 chars of id)', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'abcdef123456', source: 'startup' }), 0);
    expect(s.snapshot().sessions.abcdef123456.subLabel).toBeUndefined();
    const out = s.applyHook(
      ev({ hook_event_name: 'SessionStart', session_id: 'zzzzzz999', source: 'startup', session_title: 'Fix login' }),
      100,
    );
    expect(out).toEqual([{ kind: 'session_started', sessionId: 'zzzzzz999' }]);
    const ss = s.snapshot().sessions;
    expect(ss.abcdef123456.subLabel).toBe('abcdef');
    expect(ss.zzzzzz999.subLabel).toBe('Fix login');
    // once one ends, the other no longer needs a subLabel
    s.applyHook(ev({ hook_event_name: 'SessionEnd', session_id: 'zzzzzz999' }), 200);
    expect(s.snapshot().sessions.abcdef123456.subLabel).toBeUndefined();
  });
});

describe('OfficeStore: subagents', () => {
  it('SubagentStart creates agent (status spawning→working), emits spawned; task filled from matching Agent PreToolUse per hook-notes', () => {
    const s = new OfficeStore();
    const events = load('single-subagent');
    const iStart = idx(events, (e) => e.hook_event_name === 'SubagentStart');
    const { out, t } = replay(s, events.slice(0, iStart + 1));
    expect(out).toContainEqual({ kind: 'spawned', sessionId: SINGLE_SID, agentId: SINGLE_AGENT });
    let a = s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT];
    expect(a.status).toBe('spawning');
    expect(a.type).toBe('Explore');
    expect(a.parentId).toBeNull();
    expect(a.task).toBe('List files in ao folder');
    expect(a.startedAt).toBe(t);
    expect(s.snapshot().sessions[SINGLE_SID].boss.status).toBe('delegating');
    // first tool activity → working
    s.applyHook(events[iStart + 1], t + 100);
    a = s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT];
    expect(a.status).toBe('working');
  });

  it('SubagentStart with a description (synthetic, from discovery) sets the task', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Plan', description: 'do it' }), 0);
    expect(s.snapshot().sessions.S1.agents.A.task).toBe('do it');
  });

  it('spawning → working on tick after 2 s without activity', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Plan' }), 0);
    expect(s.tick(1_999)).toEqual([]);
    expect(s.snapshot().sessions.S1.agents.A.status).toBe('spawning');
    s.tick(2_000);
    expect(s.snapshot().sessions.S1.agents.A.status).toBe('working');
  });

  it('parallel: each agent gets its own task from its own PreToolUse(Agent)', () => {
    const s = new OfficeStore();
    replay(s, load('parallel-subagents'));
    const ag = Object.values(s.snapshot().sessions)[0].agents;
    expect(ag.a66a910909af3da94.task).toBe('List files in folder');
    expect(ag.af783427ca835f209.task).toBe('Count lines in package.json');
  });

  it('PostToolUse(Agent).tool_response.agentId corrects a wrong live guess', () => {
    const s = new OfficeStore();
    // two PreToolUse(Agent), starts arrive in reverse order with same type → FIFO guess is wrong
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'T1', tool_input: { description: 'first', subagent_type: 'Explore' } }), 0);
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'T2', tool_input: { description: 'second', subagent_type: 'Explore' } }), 1);
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'B', agent_type: 'Explore' }), 2);
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }), 3);
    s.applyHook(ev({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'T1', tool_response: { agentId: 'A', status: 'async_launched' } }), 4);
    s.applyHook(ev({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'T2', tool_response: { agentId: 'B', status: 'async_launched' } }), 5);
    const ag = s.snapshot().sessions.S1.agents;
    expect(ag.A.task).toBe('first');
    expect(ag.B.task).toBe('second');
  });

  it('prefers the pending PreToolUse whose subagent_type matches agent_type', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'T1', tool_input: { description: 'plan it', subagent_type: 'Plan' } }), 0);
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'T2', tool_input: { description: 'look around' } }), 1);
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'G', agent_type: 'general-purpose' }), 2);
    expect(s.snapshot().sessions.S1.agents.G.task).toBe('look around');
  });

  it('named agent: tool_input.name becomes the agent name (named-agent fixture), and it is an ordinary child', () => {
    const s = new OfficeStore();
    replay(s, load('named-agent'));
    const sess = Object.values(s.snapshot().sessions);
    expect(sess).toHaveLength(1);
    const a = sess[0].agents.a70dbf89fb1e2c4aa;
    expect(a.name).toBe('helper');
    expect(a.parentId).toBeNull();
    expect(a.task).toBe('List files in scratchpad folder');
  });

  it('SubagentStop → handing_off, emits handoff toId boss; after handoff the agent becomes gone and emits left', () => {
    const s = new OfficeStore();
    const events = load('single-subagent');
    const iStop = idx(events, (e) => e.hook_event_name === 'SubagentStop');
    const { out, t } = replay(s, events.slice(0, iStop + 1));
    expect(out).toContainEqual({ kind: 'handoff', sessionId: SINGLE_SID, agentId: SINGLE_AGENT, toId: 'boss' });
    let a = s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT];
    expect(a.status).toBe('handing_off');
    expect(a.endedAt).toBe(t);
    // a duplicate stop does not emit again
    expect(s.applyHook(events[iStop], t + 10)).toEqual([]);
    expect(s.tick(t + 5_999)).toEqual([]);
    expect(s.tick(t + 6_000)).toEqual([{ kind: 'left', sessionId: SINGLE_SID, agentId: SINGLE_AGENT }]);
    a = s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT];
    expect(a.status).toBe('gone');
    // gone agents stay visible for 60 s, then drop out of snapshots
    s.tick(t + 6_000 + 59_999);
    expect(s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT]).toBeDefined();
    s.tick(t + 6_000 + 60_000);
    expect(s.snapshot().sessions[SINGLE_SID].agents[SINGLE_AGENT]).toBeUndefined();
  });

  it('the late foreground PostToolUse(Agent) does not resurrect a pruned agent', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'T1', tool_input: { description: 'x' } }), 0);
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'general-purpose' }), 1);
    s.applyHook(ev({ hook_event_name: 'SubagentStop', agent_id: 'A' }), 2);
    s.tick(10_000);
    s.tick(100_000);
    expect(s.snapshot().sessions.S1.agents.A).toBeUndefined();
    const out = s.applyHook(ev({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'T1', tool_response: { agentId: 'A', status: 'completed' } }), 100_001);
    expect(out).toEqual([]);
    expect(s.snapshot().sessions.S1.agents.A).toBeUndefined();
  });

  it("nested: child's SubagentStop emits handoff toId = parent agent id", () => {
    const s = new OfficeStore();
    const events = load('nested-subagent');
    const { out } = replay(s, events);
    const sid = events[0].session_id;
    expect(out).toContainEqual({ kind: 'handoff', sessionId: sid, agentId: NESTED_CHILD, toId: NESTED_PARENT });
    expect(out).toContainEqual({ kind: 'handoff', sessionId: sid, agentId: NESTED_PARENT, toId: 'boss' });
    const ag = s.snapshot().sessions[sid].agents;
    expect(ag[NESTED_CHILD].parentId).toBe(NESTED_PARENT);
    expect(ag[NESTED_CHILD].task).toBe('List files in scratchpad ao folder');
    expect(ag[NESTED_PARENT].parentId).toBeNull();
  });

  it('no activity for 180s → quiet; any PreToolUse/PostToolUse/applyLog for that agent → working', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }), 0);
    s.applyHook(ev({ hook_event_name: 'PreToolUse', agent_id: 'A', tool_name: 'Bash', tool_use_id: 'b1' }), 1_000);
    const status = () => s.snapshot().sessions.S1.agents.A.status;
    s.tick(1_000 + 179_999);
    expect(status()).toBe('working');
    expect(s.tick(1_000 + 180_000)).toEqual([]);
    expect(status()).toBe('quiet');

    s.applyHook(ev({ hook_event_name: 'PostToolUse', agent_id: 'A', tool_name: 'Bash', tool_use_id: 'b1' }), 200_000);
    expect(status()).toBe('working');

    s.tick(200_000 + 180_000);
    expect(status()).toBe('quiet');
    s.applyHook(ev({ hook_event_name: 'PreToolUse', agent_id: 'A', tool_name: 'Read', tool_use_id: 'r1' }), 400_000);
    expect(status()).toBe('working');

    s.tick(400_000 + 180_000);
    expect(status()).toBe('quiet');
    s.applyLog('S1', 'A', { toolUses: [{ name: 'Grep', input: { pattern: 'foo' } }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, messageId: 'm1' }, 600_000);
    expect(status()).toBe('working');
    expect(s.snapshot().sessions.S1.agents.A.stats.outputTokens).toBe(2);
    expect(s.snapshot().sessions.S1.agents.A.stats.tools.Grep).toBe(1);
  });

  it('stuckMs is configurable; SubagentHandback is not counted as activity', () => {
    const s = new OfficeStore({ stuckMs: 1_000 });
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }), 0);
    s.tick(1_000);
    expect(s.snapshot().sessions.S1.agents.A.status).toBe('quiet');
    s.applyHook(ev({ hook_event_name: 'PreToolUse', agent_id: 'A', tool_name: 'SubagentHandback', tool_use_id: 'h' }), 1_500);
    expect(s.snapshot().sessions.S1.agents.A.status).toBe('quiet');
  });

  it('applyLog lowers startedAt to an earlier log timestamp (boss and agent), never raises it', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 5000);
    s.applyLog('S1', null, { toolUses: [], timestamp: 1000 }, 6000);
    expect(s.snapshot().sessions.S1.boss.startedAt).toBe(1000);
    s.applyLog('S1', null, { toolUses: [], timestamp: 3000 }, 7000);
    expect(s.snapshot().sessions.S1.boss.startedAt).toBe(1000);
    s.applyLog('S1', 'A', { toolUses: [], timestamp: 2000 }, 8000);
    expect(s.snapshot().sessions.S1.agents.A.startedAt).toBe(2000);
  });

  it('applyLog with agentId null updates the boss stats', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyLog('S1', null, { model: 'claude-haiku-5-5', toolUses: [], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, messageId: 'm' }, 50);
    s.applyLog('S1', null, { toolUses: [], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, messageId: 'm' }, 60);
    const b = s.snapshot().sessions.S1.boss;
    expect(b.stats.inputTokens).toBe(10);
    expect(b.stats.model).toBe('claude-haiku-5-5');
    expect(s.snapshot().sessions.S1.lastActivity).toBe(60);
  });
});

describe('OfficeStore: boss', () => {
  it('Stop with no running agents → boss idle; Stop with running agents → waiting_on_team (background fixture)', () => {
    const s = new OfficeStore();
    const events = load('background-agent');
    const sid = events[0].session_id;
    const firstStop = idx(events, (e) => e.hook_event_name === 'Stop');
    const { t } = replay(s, events.slice(0, firstStop + 1));
    expect(s.snapshot().sessions[sid].boss.status).toBe('waiting_on_team');
    expect(s.snapshot().sessions[sid].agents[BG_AGENT].status).not.toBe('handing_off');

    replay(s, events.slice(firstStop + 1, events.length - 1), t + 100);
    expect(s.snapshot().sessions[sid].boss.status).toBe('idle');
  });

  it('room stays non-idle while any agent is working, even after Stop', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 0);
    s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }), 10);
    expect(s.snapshot().sessions.S1.boss.status).toBe('delegating');
    s.applyHook(ev({ hook_event_name: 'Stop' }), 20);
    expect(s.snapshot().sessions.S1.boss.status).toBe('waiting_on_team');
    // still waiting while the agent is quiet
    s.tick(500_000);
    expect(s.snapshot().sessions.S1.agents.A.status).toBe('quiet');
    expect(s.snapshot().sessions.S1.boss.status).toBe('waiting_on_team');
    s.applyHook(ev({ hook_event_name: 'SubagentStop', agent_id: 'A' }), 500_010);
    expect(s.snapshot().sessions.S1.boss.status).toBe('idle');
  });

  it('Stop.background_tasks lists a running agent the store has not seen → created, boss waiting_on_team', () => {
    const s = new OfficeStore();
    const out = s.applyHook(
      ev({ hook_event_name: 'Stop', background_tasks: [{ id: 'BG', type: 'subagent', status: 'running', description: 'bg job', agent_type: 'general-purpose' }] }),
      0,
    );
    expect(out).toContainEqual({ kind: 'spawned', sessionId: 'S1', agentId: 'BG' });
    const sess = s.snapshot().sessions.S1;
    expect(sess.agents.BG.task).toBe('bg job');
    expect(sess.boss.status).toBe('waiting_on_team');
  });

  it('synthetic <agent-message> UserPromptSubmit does not clear needs_you', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 0);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: '<agent-message from="abc">done</agent-message>' }), 1);
    expect(s.snapshot().sessions.S1.boss.status).toBe('needs_you');
  });

  it('Notification (permission/input) → needs_you; cleared by next UserPromptSubmit or PreToolUse', () => {
    const s = new OfficeStore();
    const boss = () => s.snapshot().sessions.S1.boss.status;
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 0);
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 10);
    expect(boss()).toBe('needs_you');
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'x' }), 20);
    expect(boss()).toBe('working');

    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: 'Claude has a question' }), 30);
    expect(boss()).toBe('needs_you');
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'next' }), 40);
    expect(boss()).toBe('working');

    // fallback on message text only when notification_type is missing
    s.applyHook(ev({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Edit' }), 50);
    expect(boss()).toBe('needs_you');
  });

  it('idle_prompt (and "waiting for your input") leaves an idle boss idle, and the room can still be taken over', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 0);
    s.applyHook(ev({ hook_event_name: 'Stop' }), 10);
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }), 60_010);
    expect(s.snapshot().sessions.S1.boss.status).toBe('idle');
    s.applyHook(ev({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' }), 60_020);
    expect(s.snapshot().sessions.S1.boss.status).toBe('idle');
    const out = s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'S2', source: 'clear' }), 60_030);
    expect(out).toEqual([{ kind: 'shift_change', fromSessionId: 'S1', toSessionId: 'S2' }]);
  });

  it('permission_prompt sets needs_you; "permission" in the message with a non-permission notification_type does not', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'Stop' }), 0);
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'auth_success', message: 'permission granted' }), 10);
    expect(s.snapshot().sessions.S1.boss.status).toBe('idle');
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 20);
    expect(s.snapshot().sessions.S1.boss.status).toBe('needs_you');
  });

  it('other notifications are ignored', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 0);
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'auth_success', message: 'Authenticated' }), 10);
    expect(s.snapshot().sessions.S1.boss.status).toBe('working');
  });
});

describe('OfficeStore: teammates', () => {
  it('teammate session linkable to its lead (rule from hook-notes) → appears as an agent in the lead room', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'LEAD', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', session_id: 'LEAD', prompt: 'make a team' }), 10);
    const out = s.applyHook(
      ev({ hook_event_name: 'SessionStart', session_id: 'MATE', source: 'startup', lead_session_id: 'LEAD', agent_name: 'helper', agent_type: 'teammate' }),
      20,
    );
    expect(out).toEqual([{ kind: 'spawned', sessionId: 'LEAD', agentId: 'MATE' }]);
    let snap = s.snapshot();
    expect(Object.keys(snap.sessions)).toEqual(['LEAD']);
    expect(snap.sessions.LEAD.agents.MATE.name).toBe('helper');
    expect(snap.sessions.LEAD.boss.status).toBe('delegating');

    s.applyHook(ev({ hook_event_name: 'PreToolUse', session_id: 'MATE', tool_name: 'Bash', tool_use_id: 'm1' }), 30);
    expect(s.snapshot().sessions.LEAD.agents.MATE.status).toBe('working');
    s.applyLog('MATE', null, { toolUses: [], usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 } }, 35);
    expect(s.snapshot().sessions.LEAD.agents.MATE.stats.outputTokens).toBe(4);

    const end = s.applyHook(ev({ hook_event_name: 'SessionEnd', session_id: 'MATE' }), 40);
    expect(end).toEqual([{ kind: 'handoff', sessionId: 'LEAD', agentId: 'MATE', toId: 'boss' }]);
    snap = s.snapshot();
    expect(Object.keys(snap.sessions)).toEqual(['LEAD']);
    expect(snap.sessions.LEAD.status).toBe('active');
  });

  it('unlinkable teammate (unknown lead or different folder) → its own room', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'LEAD', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'M1', source: 'startup', lead_session_id: 'NOPE' }), 10);
    s.applyHook(ev({ hook_event_name: 'SessionStart', session_id: 'M2', cwd: '/elsewhere/x', source: 'startup', lead_session_id: 'LEAD' }), 20);
    expect(Object.keys(s.snapshot().sessions).sort()).toEqual(['LEAD', 'M1', 'M2']);
  });
});

describe('OfficeStore: robustness', () => {
  it('SubagentStop / PostToolUse for unknown session or agent creates entries on demand and never throws', () => {
    const s = new OfficeStore();
    const out1 = s.applyHook({ hook_event_name: 'SubagentStop', session_id: 'NEW', cwd: '/a/b', agent_id: 'Z' }, 0);
    expect(out1).toContainEqual({ kind: 'session_started', sessionId: 'NEW' });
    expect(out1).toContainEqual({ kind: 'handoff', sessionId: 'NEW', agentId: 'Z', toId: 'boss' });
    expect(s.snapshot().sessions.NEW.agents.Z.status).toBe('handing_off');
    expect(s.snapshot().sessions.NEW.label).toBe('b');

    s.applyHook({ hook_event_name: 'PostToolUse', session_id: 'NEW2', agent_id: 'Q', tool_name: 'Read' }, 1);
    expect(s.snapshot().sessions.NEW2.agents.Q.status).toBe('working');
    expect(s.snapshot().sessions.NEW2.label).toBe('unknown');
    // cwd learned later fills the label
    s.applyHook({ hook_event_name: 'PreToolUse', session_id: 'NEW2', cwd: '/x/y/', tool_name: 'Read' }, 2);
    expect(s.snapshot().sessions.NEW2.label).toBe('y');

    s.applyLog('NEW3', 'K', { toolUses: [] }, 3);
    expect(s.snapshot().sessions.NEW3.agents.K).toBeDefined();
  });

  it('garbage input never throws', () => {
    const s = new OfficeStore();
    const junk: unknown[] = [
      {},
      { hook_event_name: 'SessionStart' },
      { hook_event_name: 'PostToolUse', session_id: 'S', tool_name: 'Agent', tool_response: 'str' },
      { hook_event_name: 'PostToolUse', session_id: 'S', tool_name: 'Agent', tool_response: null, tool_use_id: 5 },
      { hook_event_name: 'Stop', session_id: 'S', background_tasks: 'nope' },
      { hook_event_name: 'Stop', session_id: 'S', background_tasks: [null, 3, { id: 7 }] },
      { hook_event_name: 'Notification', session_id: 'S', message: 42 },
      { hook_event_name: 'SessionStart', session_id: 'S', cwd: 12, source: 'clear' },
      { hook_event_name: 'Whatever', session_id: 'S' },
      null,
    ];
    for (const j of junk) expect(() => s.applyHook(j as HookEvent, 1)).not.toThrow();
    expect(() => s.applyLog('S', null, null as never, 2)).not.toThrow();
    expect(() => s.tick(NaN)).not.toThrow();
    expect(() => s.snapshot()).not.toThrow();
  });

  it('onChange receives emitted events; snapshot is a copy', () => {
    const s = new OfficeStore();
    const got: OfficeEvent[][] = [];
    s.onChange((e) => got.push(e));
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    expect(got).toEqual([[{ kind: 'session_started', sessionId: 'S1' }]]);
    s.applyLog('S1', null, { toolUses: [] }, 1);
    expect(got).toHaveLength(2);
    expect(s.tick(2)).toEqual([]);
    expect(got).toHaveLength(2); // nothing changed, no notification
    const snap = s.snapshot();
    snap.sessions.S1.label = 'mutated';
    expect(s.snapshot().sessions.S1.label).toBe('proj');
  });

  it('ended sessions drop out of snapshots 60 s after ending', () => {
    const s = new OfficeStore();
    s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
    s.applyHook(ev({ hook_event_name: 'SessionEnd', reason: 'other' }), 100);
    s.tick(100 + 59_999);
    expect(s.snapshot().sessions.S1).toBeDefined();
    s.tick(100 + 60_000);
    expect(s.snapshot().sessions.S1).toBeUndefined();
  });

  it('every fixture replays end to end without throwing and ends with an ended session', () => {
    for (const f of ['single-subagent', 'parallel-subagents', 'nested-subagent', 'background-agent', 'named-agent', 'clear-resume']) {
      const s = new OfficeStore();
      replay(s, load(f));
      const sess = Object.values(s.snapshot().sessions);
      expect(sess).toHaveLength(1);
      expect(sess[0].status).toBe('ended');
    }
  });
});

describe('applyLog session metadata', () => {
  it('delta gitBranch sets branch; delta cwd fills missing cwd/label but never overwrites', () => {
    const s = new OfficeStore();
    s.applyLog('S9', null, { toolUses: [], gitBranch: 'main', cwd: '/work/proj' }, 100);
    let sess = s.snapshot().sessions.S9!;
    expect(sess.branch).toBe('main');
    expect(sess.cwd).toBe('/work/proj');
    expect(sess.label).toBe('proj');
    s.applyLog('S9', null, { toolUses: [], gitBranch: 'dev', cwd: '/other/place' }, 200);
    sess = s.snapshot().sessions.S9!;
    expect(sess.branch).toBe('dev');
    expect(sess.cwd).toBe('/work/proj');
  });
});

describe('registry helpers', () => {
  const start = (s: OfficeStore, t: number) => s.applyHook({ hook_event_name: 'SessionStart', source: 'discovered', session_id: 'R1', cwd: '/w/r' }, t);

  it('markLive keeps a live session from timing out; it ends endedMs after the last live mark', () => {
    const s = new OfficeStore({ endedMs: 1000 });
    start(s, 0);
    s.markLive('R1', 900);
    s.tick(1500);
    expect(s.snapshot().sessions.R1.status).toBe('active');
    s.tick(1900);
    expect(s.snapshot().sessions.R1.status).toBe('ended');
  });

  it('setName sets, changes and clears the session name', () => {
    const s = new OfficeStore();
    start(s, 0);
    let n = 0;
    s.onChange(() => n++);
    s.setName('R1', 'alpha');
    s.setName('R1', 'alpha');
    expect(s.snapshot().sessions.R1.name).toBe('alpha');
    expect(n).toBe(1);
    s.setName('R1', undefined);
    expect(s.snapshot().sessions.R1.name).toBeUndefined();
    s.setName('nope', 'x');
    expect(s.snapshot().sessions.nope).toBeUndefined();
  });

  it('a repeated SubagentStart fills a missing task without a second spawn', () => {
    const s = new OfficeStore();
    start(s, 0);
    const ev: OfficeEvent[] = [];
    s.onChange((e) => ev.push(...e));
    s.applyHook({ hook_event_name: 'SubagentStart', session_id: 'R1', agent_id: 'a' }, 1);
    s.applyHook({ hook_event_name: 'SubagentStart', session_id: 'R1', agent_id: 'a', agent_type: 'Explore', description: 'look around' }, 2);
    const a = s.snapshot().sessions.R1.agents.a;
    expect(a.type).toBe('Explore');
    expect(a.task).toBe('look around');
    expect(ev.filter((e) => e.kind === 'spawned')).toHaveLength(1);
  });
});
