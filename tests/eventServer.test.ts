import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { OfficeStore } from '../src/core/store.js';
import { startEventServer } from '../src/server/eventServer.js';
import { startApp } from '../src/core/app.js';
import type { ServerMessage } from '../src/shared/types.js';

const TOKEN = 'tok-123';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

function staticDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ao-static-'));
  writeFileSync(join(d, 'index.html'), '<h1>office</h1>');
  mkdirSync(join(d, 'sub'));
  writeFileSync(join(d, 'sub', 'a.js'), 'x');
  writeFileSync(join(d, '..', 'ao-secret.txt'), 'secret');
  return d;
}

async function boot() {
  const port = await freePort();
  const store = new OfficeStore();
  const dir = staticDir();
  const srv = await startEventServer({ port, token: TOKEN, store, staticDir: dir });
  closers.push(() => srv.close());
  return { port, store, srv, dir };
}

const hook = { hook_event_name: 'SessionStart', session_id: 'S1', cwd: '/w/proj', source: 'startup' };

function post(port: number, body: string | Buffer, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/event', method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    req.on('error', (e) => {
      // server may reset the connection after replying 413 to an oversized body
      if ((e as NodeJS.ErrnoException).code === 'ECONNRESET' || (e as NodeJS.ErrnoException).code === 'EPIPE') resolve(413);
      else reject(e);
    });
    req.end(body);
  });
}

const auth = { 'x-agent-office-token': TOKEN, 'content-type': 'application/json' };

describe('event server', () => {
  it('POST /event with valid token → 204 and store updated', async () => {
    const { port, store } = await boot();
    expect(await post(port, JSON.stringify(hook), auth)).toBe(204);
    expect(store.snapshot().sessions.S1).toBeTruthy();
  });

  it('missing/wrong token → 401; malformed JSON → 400; body > 1 MB → 413; server still serves', async () => {
    const { port, store } = await boot();
    expect(await post(port, JSON.stringify(hook), {})).toBe(401);
    expect(await post(port, JSON.stringify(hook), { 'x-agent-office-token': 'nope' })).toBe(401);
    expect(await post(port, '{not json', auth)).toBe(400);
    expect(await post(port, Buffer.alloc(1_100_000, 'a'), auth)).toBe(413);
    expect(Object.keys(store.snapshot().sessions)).toHaveLength(0);
    expect(await post(port, JSON.stringify(hook), auth)).toBe(204);
    const r = await fetch(`http://127.0.0.1:${port}/`);
    expect(r.status).toBe(200);
  });

  it('serves static files and blocks path traversal', async () => {
    const { port } = await boot();
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain('office');
    expect((await fetch(`http://127.0.0.1:${port}/sub/a.js`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/nothing`)).status).toBe(404);
    for (const p of ['/../ao-secret.txt', '/%2e%2e/ao-secret.txt', '/sub/%2e%2e/%2e%2e/ao-secret.txt']) {
      // raw request so the client does not normalise the path
      const status = await new Promise<number>((resolve) => {
        request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        }).end();
      });
      expect([400, 403, 404]).toContain(status);
    }
  });

  it('WS without token is rejected; with token gets snapshot then events after a POST', async () => {
    const { port } = await boot();
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const err = await new Promise<string>((res) => {
      bad.on('error', (e) => res(String(e)));
      bad.on('open', () => res('opened'));
    });
    expect(err).toContain('401');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs[0]!.type).toBe('snapshot');
    await post(port, JSON.stringify(hook), auth);
    await new Promise((r) => setTimeout(r, 100));
    const ev = msgs.find((m) => m.type === 'events');
    expect(ev).toBeTruthy();
    if (ev?.type === 'events') {
      expect(ev.events.some((e) => e.kind === 'session_started')).toBe(true);
      expect(ev.state.sessions.S1).toBeTruthy();
    }
    ws.close();
  });

  it('second server on same port rejects with "port <n> in use"', async () => {
    const { port, store, dir } = await boot();
    await expect(startEventServer({ port, token: TOKEN, store, staticDir: dir })).rejects.toThrow(`port ${port} in use`);
  });

  it('binds only to 127.0.0.1', async () => {
    const { srv, port } = await boot();
    expect(srv.url).toBe(`http://127.0.0.1:${port}`);
    const { networkInterfaces } = await import('node:os');
    const other = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (other) {
      const ok = await new Promise<boolean>((res) => {
        const req = request({ host: other.address, port, path: '/', timeout: 500 }, () => res(true));
        req.on('error', () => res(false));
        req.on('timeout', () => { req.destroy(); res(false); });
        req.end();
      });
      expect(ok).toBe(false);
    }
  });
});

describe('startApp', () => {
  it('watches boss and subagent logs from start and feeds the store', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ao-claude-'));
    const cfgDir = mkdtempSync(join(tmpdir(), 'ao-cfg-'));
    const tp = join(home, 'S2.jsonl');
    const line = (extra: object) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), gitBranch: 'feat', cwd: '/w/app', message: { id: 'm1', model: 'claude-sonnet-4-5', role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: 5 } }, ...extra }) + '\n';
    writeFileSync(tp, line({}));
    const port = await freePort();
    const app = await startApp({ port, token: TOKEN, claudeDir: home, configDir: cfgDir, staticDir: staticDir() });
    closers.push(() => app.close());
    expect(await post(port, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'S2', cwd: '/w/app', transcript_path: tp }), auth)).toBe(204);
    await new Promise((r) => setTimeout(r, 1500));
    const s = app.store.snapshot().sessions.S2!;
    expect(s.boss.stats.outputTokens).toBe(5);
    expect(s.branch).toBe('feat');
  });
});
