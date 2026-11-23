import { describe, it, expect } from 'vitest';
import { looksFor, agentLook, bossLook, truncate, formatTokens, totalTokens, formatTimer } from '../src/scene/looks.js';
import type { AgentStats } from '../src/shared/types.js';

const stats = (o: Partial<AgentStats> = {}): AgentStats => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0, ...o });

describe('looksFor', () => {
  it('gives known types their fixed accessory', () => {
    expect(looksFor('Explore').accessory).toBe('headphones');
    expect(looksFor('Plan').accessory).toBe('notepad');
    expect(looksFor('code-reviewer').accessory).toBe('glasses');
    expect(looksFor('main').accessory).toBe('crown');
    expect(looksFor('general-purpose').accessory).toBe('hat');
  });

  it('is stable per type', () => {
    expect(looksFor('Explore')).toEqual(looksFor('Explore'));
    expect(looksFor('my-custom-agent')).toEqual(looksFor('my-custom-agent'));
  });

  it('gives unknown types a hashed hex color and no accessory', () => {
    const a = looksFor('my-custom-agent');
    const b = looksFor('another-agent');
    expect(a.accessory).toBe('none');
    expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.color).not.toBe(b.color);
  });
});

describe('status mappings', () => {
  it('maps agent statuses to poses', () => {
    expect(agentLook('working')).toMatchObject({ pose: 'type', mood: 'focus', screen: 'code', fx: 'none' });
    expect(agentLook('quiet')).toMatchObject({ pose: 'scratch', mood: 'worried', screen: 'err', fx: 'stuck' });
    expect(agentLook('spawning').pose).toBe('stand');
    expect(agentLook('handing_off').pose).toBe('stand');
  });

  it('maps boss statuses to poses', () => {
    expect(bossLook('idle')).toMatchObject({ mood: 'sleepy', fx: 'zzz', dim: true });
    expect(bossLook('needs_you')).toMatchObject({ pose: 'raise_hand', fx: 'alert', dim: false });
    expect(bossLook('waiting_on_team')).toMatchObject({ fx: 'tap', dim: false });
    expect(bossLook('working').pose).toBe('type');
    expect(bossLook('delegating').pose).toBe('type');
  });
});

describe('text helpers', () => {
  it('truncates with an ellipsis', () => {
    expect(truncate('short', 28)).toBe('short');
    const t = truncate('Find every place auth middleware is wired up', 28);
    expect(t.length).toBeLessThanOrEqual(28);
    expect(t.startsWith('Find every place auth')).toBe(true);
    expect(t.endsWith('…')).toBe(true);
    expect(truncate(undefined, 28)).toBe('');
    expect(truncate('  multi\n line  ', 28)).toBe('multi line');
  });

  it('totals input + output + cacheWrite, not cacheRead', () => {
    expect(totalTokens(stats({ inputTokens: 100, outputTokens: 20, cacheWrite: 5, cacheRead: 9999 }))).toBe(125);
  });

  it('formats tokens simply', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12345)).toBe('12.3k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formats a quiet timer as m:ss', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(400_000)).toBe('6:40');
    expect(formatTimer(-5)).toBe('0:00');
  });
});
