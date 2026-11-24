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

describe('POST /shutdown', () => {
  async function bootAs(startedBy: 'plugin' | 'app') {
    const port = await freePort();
    const d = mkdtempSync(join(tmpdir(), 'ao-sd-'));
    writeFileSync(join(d, 'index.html'), 'x');
    let asked = 0;
    const app = await startApp({ port, token: 'tk', configDir: d, claudeDir: mkdtempSync(join(tmpdir(), 'ao-cl-')), staticDir: d, startedBy, onShutdown: () => asked++ });
    closers.push(() => app.close());
    const post = (token?: string) => fetch(`${app.url}/shutdown`, { method: 'POST', headers: token ? { 'X-Agent-Office-Token': token } : {} });
    return { app, post, asked: () => asked };
  }

  it('requires the token', async () => {
    const { post, asked } = await bootAs('plugin');
    expect((await post()).status).toBe(401);
    expect((await post('nope')).status).toBe(401);
    expect(asked()).toBe(0);
  });

  it('stops a tracker the plugin started', async () => {
    const { post, asked } = await bootAs('plugin');
    const r = await post('tk');
    expect(r.status).toBe(202);
    await new Promise((res) => setTimeout(res, 20));
    expect(asked()).toBe(1);
  });

  it('refuses with 409 when the app runs it', async () => {
    const { post, asked } = await bootAs('app');
    expect((await post('tk')).status).toBe(409);
    expect(asked()).toBe(0);
  });

  it('is POST only', async () => {
    const { app, asked } = await bootAs('plugin');
    const r = await fetch(`${app.url}/shutdown`, { headers: { 'X-Agent-Office-Token': 'tk' } });
    expect(r.status).not.toBe(202);
    expect(asked()).toBe(0);
  });
});
