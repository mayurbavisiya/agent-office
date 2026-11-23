import { describe, it, expect } from 'vitest';
import { contextSize, estimateCost, MODELS } from '../src/core/pricing.js';
import { emptyStats } from '../src/core/logParser.js';

describe('pricing', () => {
  it('estimateCost returns null for unknown model', () => {
    expect(estimateCost({ ...emptyStats(0), model: 'mystery-1', inputTokens: 100 })).toBeNull();
    expect(estimateCost(emptyStats(0))).toBeNull();
  });

  it('contextSize is undefined for unknown/missing model', () => {
    expect(contextSize('mystery-1')).toBeUndefined();
    expect(contextSize(undefined)).toBeUndefined();
  });

  it('knows claude-haiku-5-5 (docs: $0.10 in, $0.50 out, $0.01 cache read, 1M context)', () => {
    expect(contextSize('claude-haiku-5-5')).toBe(1_000_000);
    const s = { ...emptyStats(0), model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
    const w = MODELS['claude-haiku-5-5'].cacheWritePerM;
    expect(estimateCost(s)).toBeCloseTo(0.1 + 0.5 + 0.01 + w, 10);
  });

  it('every table entry has numeric prices and context', () => {
    for (const m of Object.values(MODELS)) {
      for (const v of [m.inputPerM, m.outputPerM, m.cacheReadPerM, m.cacheWritePerM, m.contextSize]) expect(v).toBeGreaterThan(0);
    }
  });
});
