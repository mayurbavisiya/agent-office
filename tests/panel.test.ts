import { describe, it, expect } from 'vitest';
import { formatTokens, formatDuration, formatCost, panelModel } from '../src/scene/panel.js';
import type { Agent, AgentStats, Session } from '../src/shared/types.js';

const stats = (o: Partial<AgentStats> = {}): AgentStats => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0, ...o });
const agent = (id: string, o: Partial<Agent> = {}): Agent => ({ id, sessionId: 's1', parentId: null, type: 'Explore', status: 'working', startedAt: 1000, stats: stats(), ...o });
const session = (agents: Agent[] = [], o: Partial<Session['boss']> = {}): Session => ({
  id: 's1', cwd: '/x/proj', label: 'proj', status: 'active', lastActivity: 0,
  boss: { status: 'working', startedAt: 1000, stats: stats(), ...o },
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
});

describe('formatters', () => {
  it('formatTokens', () => {
    expect(formatTokens(undefined)).toBe('—');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(48210)).toBe('48.2k');
    expect(formatTokens(1_250_000)).toBe('1.25M');
  });
  it('formatDuration', () => {
    expect(formatDuration(812000)).toBe('13m 32s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(3_725_000)).toBe('1h 02m');
    expect(formatDuration(-1)).toBe('0s');
  });
  it('formatCost', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(0.4581)).toBe('~$0.458');
  });
});

describe('panelModel', () => {
  it('for boss includes team totals spawned/done/stuck', () => {
    const s = session([agent('a'), agent('b', { status: 'gone' }), agent('c', { status: 'handing_off' }), agent('d', { status: 'quiet' })]);
    const m = panelModel({ session: s, agentId: 'boss' }, 5000)!;
    expect(m.name).toBe('Main agent');
    expect(m.team).toEqual({ spawned: 4, done: 2, stuck: 1 });
    expect(m.statusLabel).toBe('Working');
  });

  it('with empty stats shows "—" for model, tokens, cost, context', () => {
    const m = panelModel({ session: session([agent('a')]), agentId: 'a' }, 5000)!;
    expect(m.model).toBe('—');
    expect([m.tokens.input, m.tokens.output, m.tokens.cacheRead, m.tokens.cacheWrite]).toEqual(['—', '—', '—', '—']);
    expect(m.cost).toBe('—');
    expect(m.contextLabel).toBe('—');
    expect(m.contextPct).toBeUndefined();
    expect(m.team).toBeUndefined();
  });

  it('computes cost, context, duration, sorted tools and a quiet label', () => {
    const a = agent('a', {
      status: 'quiet', name: 'scout', task: 'look around',
      stats: stats({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, contextFill: 0.634, lastActivity: 1000, tools: { Read: 2, Bash: 5, Grep: 2 } }),
    });
    const m = panelModel({ session: session([a]), agentId: 'a' }, 1000 + 400_000)!;
    expect(m.name).toBe('scout');
    expect(m.statusLabel).toBe('Maybe stuck · 6m 40s quiet');
    expect(m.cost).toBe('~$2.000');
    expect(m.contextPct).toBe(63);
    expect(m.tools.map((t) => t.name)).toEqual(['Bash', 'Grep', 'Read']);
    expect(m.toolTotal).toBe(9);
    expect(m.duration).toBe('6m 40s');
  });

  it('labels statuses and returns null for a missing agent', () => {
    const s = session([agent('a', { status: 'gone', endedAt: 4000 })], { status: 'needs_you' });
    expect(panelModel({ session: s, agentId: 'a' }, 9000)!.statusLabel).toBe('Left');
    expect(panelModel({ session: s, agentId: 'a' }, 9000)!.duration).toBe('3s');
    expect(panelModel({ session: s, agentId: 'boss' }, 9000)!.statusLabel).toBe('Needs you');
    expect(panelModel({ session: s, agentId: 'zzz' }, 9000)).toBeNull();
  });
});
