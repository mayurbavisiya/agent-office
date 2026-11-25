import { describe, expect, it } from 'vitest';
import { OfficeStore } from '../src/core/store.js';
import type { HookEvent } from '../src/shared/types.js';
import { agentLook } from '../src/scene/looks.js';
import { panelModel } from '../src/scene/panel.js';

const ev = (o: Partial<HookEvent> & { hook_event_name: string }): HookEvent => ({ session_id: 'S1', cwd: '/work/proj', ...o });
const MIN = 60_000;

/** A session whose lead has one subagent, A1, at work. */
function withHelper(): OfficeStore {
  const s = new OfficeStore({ stuckMs: 3 * MIN });
  s.applyHook(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 0);
  s.applyHook(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), 10);
  s.applyHook(ev({ hook_event_name: 'SubagentStart', agent_id: 'A1', agent_type: 'general-purpose' }), 20);
  s.applyHook(ev({ hook_event_name: 'PreToolUse', agent_id: 'A1', tool_name: 'Read', tool_use_id: 't1' }), 30);
  return s;
}
const agent = (s: OfficeStore) => s.snapshot().sessions.S1!.agents.A1!;
const boss = (s: OfficeStore) => s.snapshot().sessions.S1!.boss.status;

describe('a subagent blocked on a permission prompt', () => {
  it('PermissionRequest flags the room and the subagent that asked', () => {
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', agent_id: 'A1', tool_name: 'Write' }), 40);
    expect(boss(s)).toBe('needs_you');
    expect(agent(s).waitingOnYou).toBe(true);
  });

  it('is never "maybe stuck" while its prompt is open, and turns back when answered', () => {
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', agent_id: 'A1', tool_name: 'Write' }), 40);
    s.tick(10 * MIN);
    expect(agent(s).status).toBe('working');
    expect(agent(s).waitingOnYou).toBe(true);
    // answered: the subagent's tool runs
    s.applyHook(ev({ hook_event_name: 'PostToolUse', agent_id: 'A1', tool_name: 'Write', tool_use_id: 't2' }), 10 * MIN + 1);
    expect(agent(s).waitingOnYou).toBeUndefined();
    expect(boss(s)).not.toBe('needs_you');
  });

  it('a subagent already gone quiet that then asks is waiting, not stuck', () => {
    const s = withHelper();
    s.tick(4 * MIN);
    expect(agent(s).status).toBe('quiet');
    s.applyHook(ev({ hook_event_name: 'Notification', agent_id: 'A1', notification_type: 'permission_prompt', message: 'Claude needs your permission' }), 4 * MIN + 1);
    expect(agent(s).status).toBe('working');
    expect(agent(s).waitingOnYou).toBe(true);
  });

  it("the main agent's own prompt flags only the room", () => {
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }), 40);
    expect(boss(s)).toBe('needs_you');
    expect(agent(s).waitingOnYou).toBeUndefined();
  });

  it('the flag goes when the subagent finishes', () => {
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', agent_id: 'A1', tool_name: 'Write' }), 40);
    s.applyHook(ev({ hook_event_name: 'SubagentStop', agent_id: 'A1', agent_type: 'general-purpose' }), 50);
    expect(agent(s).waitingOnYou).toBeUndefined();
    expect(boss(s)).not.toBe('needs_you');
  });
});

describe('how a waiting subagent looks', () => {
  it('raises its hand with the alert mark, and its panel says it is waiting on you', () => {
    expect(agentLook('working', true)).toMatchObject({ pose: 'raise_hand', fx: 'alert' });
    expect(agentLook('handing_off', true).pose).not.toBe('raise_hand');
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', agent_id: 'A1', tool_name: 'Write' }), 40);
    const m = panelModel({ session: s.snapshot().sessions.S1!, agentId: 'A1' }, 50)!;
    expect(m.statusLabel).toBe('Waiting on you · its prompt is open');
  });
});

describe('PermissionRequest then Notification (the order Claude Code sends them)', () => {
  it('the unnamed Notification keeps the subagent the PermissionRequest named', () => {
    const s = withHelper();
    s.applyHook(ev({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'lead1' }), 35); // the lead has an open call too
    s.applyHook(ev({ hook_event_name: 'PermissionRequest', agent_id: 'A1', tool_name: 'Write' }), 40);
    s.applyHook(ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Write' }), 45);
    expect(agent(s).waitingOnYou).toBe(true);
  });
});
