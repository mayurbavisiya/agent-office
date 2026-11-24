import { describe, expect, it } from 'vitest';
import { TICK_MS, tickValue, tokLabel } from '../src/scene/tokTicker.js';

describe('tokTicker', () => {
  it('counts up with ease-out and lands exactly on the target', () => {
    expect(tickValue(1000, 2000, 0)).toBe(1000);
    const mid = tickValue(1000, 2000, TICK_MS / 2);
    expect(mid).toBeGreaterThan(1500); // ease-out: past halfway at half time
    expect(mid).toBeLessThan(2000);
    expect(tickValue(1000, 2000, TICK_MS)).toBe(2000);
    expect(tickValue(1000, 2000, TICK_MS * 5)).toBe(2000);
  });
  it('counts down too (after /compact the memory shrinks)', () => {
    expect(tickValue(180_000, 20_000, TICK_MS)).toBe(20_000);
    expect(tickValue(180_000, 20_000, TICK_MS / 2)).toBeLessThan(100_000);
  });
  it('labels a value, or a dash when unknown', () => {
    expect(tokLabel(181_234)).toBe('⚡ 181.2k tok');
    expect(tokLabel(undefined)).toBe('⚡ — tok');
  });
});
