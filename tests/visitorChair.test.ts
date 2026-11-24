import { describe, expect, it } from 'vitest';
import { needsYou, officeTitle, waitingOnYou } from '../src/shared/counts.js';
import type { BossStatus, OfficeState, Session } from '../src/shared/types.js';

const session = (id: string, boss: BossStatus, status: Session['status'] = 'active'): Session =>
  ({
    id, cwd: '/x', label: id, status, lastActivity: 0,
    boss: { status: boss, startedAt: 0, stats: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0 } },
    agents: {},
  }) as unknown as Session;

describe('visitor chair: waiting on you', () => {
  it('a room needs you only while its lead is blocked on the person, and not once it ended', () => {
    expect(needsYou(session('a', 'needs_you'))).toBe(true);
    expect(needsYou(session('a', 'working'))).toBe(false);
    expect(needsYou(session('a', 'waiting_on_team'))).toBe(false);
    expect(needsYou(session('a', 'needs_you', 'ended'))).toBe(false);
  });
  it('counts the rooms waiting on you and puts the count in the tab title', () => {
    const state: OfficeState = { sessions: { a: session('a', 'needs_you'), b: session('b', 'working'), c: session('c', 'needs_you'), d: session('d', 'needs_you', 'ended') } };
    expect(waitingOnYou(state)).toBe(2);
    expect(officeTitle(2)).toBe('(2) Agent Office');
    expect(officeTitle(0)).toBe('Agent Office');
  });
});
