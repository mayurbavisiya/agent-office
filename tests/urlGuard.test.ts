import { describe, it, expect } from 'vitest';
import { isAllowedUrl } from '../src/main/urlGuard.js';
import { workingCount } from '../src/shared/counts.js';
import type { Session } from '../src/shared/types.js';

const base = 'http://127.0.0.1:47821';
describe('isAllowedUrl', () => {
  it('allows same-origin paths with query', () => {
    expect(isAllowedUrl('http://127.0.0.1:47821/?token=x&shell=electron', base)).toBe(true);
    expect(isAllowedUrl('http://127.0.0.1:47821/a/b', base)).toBe(true);
  });
  it('denies userinfo bypass, port prefix, other origins, garbage', () => {
    expect(isAllowedUrl('http://127.0.0.1:47821@evil.example/', base)).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1:478210/', base)).toBe(false);
    expect(isAllowedUrl('https://127.0.0.1:47821/', base)).toBe(false);
    expect(isAllowedUrl('http://evil.example/', base)).toBe(false);
    expect(isAllowedUrl('not a url', base)).toBe(false);
    expect(isAllowedUrl('data:text/html,hi', base)).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1:47821/', 'garbage')).toBe(false);
  });
});

describe('workingCount', () => {
  const mk = (boss: string, agents: string[], status = 'active'): Session =>
    ({ status, boss: { status: boss }, agents: Object.fromEntries(agents.map((a, i) => [String(i), { status: a }])) }) as unknown as Session;
  it('counts boss and non-quiet agents, ended is 0', () => {
    expect(workingCount(mk('delegating', ['working', 'quiet', 'gone', 'spawning', 'handing_off']))).toBe(4);
    expect(workingCount(mk('idle', ['quiet']))).toBe(0);
    expect(workingCount(mk('working', ['working'], 'ended'))).toBe(0);
  });
});
