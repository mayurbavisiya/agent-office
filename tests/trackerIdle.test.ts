import { describe, it, expect } from 'vitest';
import { shouldIdleExit } from '../src/tracker/idle.js';

describe('shouldIdleExit', () => {
  it('exits at the idle limit', () => expect(shouldIdleExit(1000 + 30 * 60000, 1000, 30)).toBe(true));
  it('stays before it', () => expect(shouldIdleExit(1000 + 29 * 60000, 1000, 30)).toBe(false));
});
