import { describe, it, expect } from 'vitest';
import { looksFor, agentLook, bossLook, truncate, totalTokens, formatTimer, humanLook, poseClass } from '../src/scene/looks.js';
import { formatTokens } from '../src/scene/panel.js';
import type { AgentStats } from '../src/shared/types.js';

const stats = (o: Partial<AgentStats> = {}): AgentStats => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: 0, ...o });

describe('looksFor', () => {
  it('gives known types their fixed colour', () => {
    expect(looksFor('Explore').color).toBe('#10b981');
    expect(looksFor('Plan').color).toBe('#3b82f6');
    expect(looksFor('code-reviewer').color).toBe('#f97316');
    expect(looksFor('general-purpose').color).toBe('#ec4899');
  });

  it('is stable per type', () => {
    expect(looksFor('Explore')).toEqual(looksFor('Explore'));
    expect(looksFor('my-custom-agent')).toEqual(looksFor('my-custom-agent'));
  });

  it('gives unknown types a hashed hex color', () => {
    const a = looksFor('my-custom-agent');
    const b = looksFor('another-agent');
    expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.color).not.toBe(b.color);
  });
});

describe('humanLook', () => {
  it('is stable per id and varies across ids', () => {
    expect(humanLook('a1', 'Explore')).toEqual(humanLook('a1', 'Explore'));
    const looks = Array.from({ length: 20 }, (_, i) => humanLook(`agent-${i}`, 'Explore'));
    expect(new Set(looks.map((l) => l.skin)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(3);
    for (const l of looks) {
      expect(['short', 'long', 'bun', 'bald', 'curly']).toContain(l.hairStyle);
      for (const c of [l.skin, l.hair, l.shirt, l.pants]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(l.tie).toBeUndefined();
    }
  });

  it('uses the agent-type colour for the shirt', () => {
    expect(humanLook('a1', 'Explore').shirt).toBe(looksFor('Explore').color);
    expect(humanLook('a1', 'my-custom-agent').shirt).toBe(looksFor('my-custom-agent').color);
  });

  it('boss wears a suit and tie', () => {
    expect(humanLook('boss', 'boss')).toMatchObject({ shirt: '#3d3a5c', tie: '#d9455f' });
    expect(humanLook('some-session-id', 'boss')).toMatchObject({ shirt: '#3d3a5c', tie: '#d9455f' });
  });
});

describe('poseClass', () => {
  it('maps statuses to pose classes', () => {
    expect(poseClass(agentLook('working'), false)).toBe('pose-type');
    expect(poseClass(agentLook('quiet'), false)).toBe('pose-slump');
    expect(poseClass(bossLook('working'), true)).toBe('pose-type');
    expect(poseClass(bossLook('delegating'), true)).toBe('pose-type');
    expect(poseClass(bossLook('needs_you'), true)).toBe('pose-wave');
    expect(poseClass(bossLook('waiting_on_team'), true)).toBe('pose-lean');
    expect(poseClass(bossLook('idle'), true)).toBe('pose-idle');
  });

  it('keeps the status overlays that go with the poses', () => {
    expect(agentLook('quiet').fx).toBe('stuck');
    expect(bossLook('idle').fx).toBe('zzz');
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
    expect(formatTokens(undefined)).toBe('—');
  });

  it('formats a quiet timer as m:ss', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(400_000)).toBe('6:40');
    expect(formatTimer(-5)).toBe('0:00');
  });
});
