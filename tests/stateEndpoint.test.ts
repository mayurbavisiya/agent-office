import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startApp } from '../src/core/app.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

async function boot() {
  const port = await freePort();
  const d = mkdtempSync(join(tmpdir(), 'ao-st-'));
  writeFileSync(join(d, 'index.html'), 'x');
  const app = await startApp({ port, token: 'tk', configDir: d, claudeDir: mkdtempSync(join(tmpdir(), 'ao-cl-')), staticDir: d, version: '9.9.9', startedBy: 'plugin' });
  closers.push(() => app.close());
  const get = (token?: string) => fetch(`${app.url}/state`, { headers: token ? { 'X-Agent-Office-Token': token } : {} });
  return { app, get };
}

describe('GET /state', () => {
  it('requires the token', async () => {
    const { get } = await boot();
    expect((await get()).status).toBe(401);
    expect((await get('nope')).status).toBe(401);
    const r = await get('tk');
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.version).toBe('9.9.9');
    expect(b.startedBy).toBe('plugin');
    expect(typeof b.seq).toBe('number');
    expect(b.state.sessions).toEqual({});
  });

  it('seq increases on store change', async () => {
    const { app, get } = await boot();
    const before = (await (await get('tk')).json()).seq;
    app.store.applyHook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/x' }, Date.now());
    const after = await (await get('tk')).json();
    expect(after.seq).toBeGreaterThan(before);
    expect(Object.keys(after.state.sessions)).toEqual(['s1']);
  });
});
