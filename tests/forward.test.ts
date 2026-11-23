import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { OfficeStore } from '../src/core/store.js';
import { startEventServer } from '../src/server/eventServer.js';

const SCRIPT = resolve('plugin/scripts/forward.sh');
const TOKEN = 'tok-fwd';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

function homeWith(config: object | null): string {
  const home = mkdtempSync(join(tmpdir(), 'ao-home-'));
  if (config) {
    mkdirSync(join(home, '.agent-office'));
    writeFileSync(join(home, '.agent-office', 'config.json'), JSON.stringify(config));
  }
  return home;
}

function run(home: string, stdin: string) {
  return new Promise<{ code: number | null; out: string; err: string; ms: number }>((resolveRun, reject) => {
    const t0 = Date.now();
    const p = spawn('sh', [SCRIPT], { env: { ...process.env, HOME: home } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => resolveRun({ code, out, err, ms: Date.now() - t0 }));
    p.stdin.on('error', () => {});
    p.stdin.end(stdin);
  });
}

async function boot() {
  const store = new OfficeStore();
  const srv = await startEventServer({ port: await freePort(), token: TOKEN, store, staticDir: tmpdir() });
  closers.push(() => srv.close());
  return { store, port: Number(new URL(srv.url).port) };
}

const ev = (extra: object = {}) => ({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: '/w/proj', source: 'startup', ...extra });

describe('forward.sh', () => {
  it('forwards stdin JSON with token header to running server', async () => {
    const { store, port } = await boot();
    const r = await run(homeWith({ port, token: TOKEN }), JSON.stringify(ev()));
    expect(r.code).toBe(0);
    expect(Object.keys(store.snapshot().sessions)).toContain('S1');
  });

  it('with a wrong token nothing is stored and it still exits 0 silently', async () => {
    const { store, port } = await boot();
    const r = await run(homeWith({ port, token: 'nope' }), JSON.stringify(ev()));
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(Object.keys(store.snapshot().sessions)).toHaveLength(0);
  });

  it('with no server running, exits 0 in under 1500 ms, silently', async () => {
    const port = await freePort();
    const r = await run(homeWith({ port, token: TOKEN }), JSON.stringify(ev()));
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(1500);
    expect(r.out).toBe('');
    expect(r.err).toBe('');
  });

  it('with missing config file, exits 0 immediately and sends nothing', async () => {
    const { store } = await boot();
    const r = await run(homeWith(null), JSON.stringify(ev()));
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(1500);
    expect(r.out).toBe('');
    expect(r.err).toBe('');
    expect(Object.keys(store.snapshot().sessions)).toHaveLength(0);
  });

  it('with 300 KB stdin payload, forwards intact', async () => {
    const { store, port } = await boot();
    const home = homeWith({ port, token: TOKEN });
    await run(home, JSON.stringify(ev()));
    const big = { hook_event_name: 'PreToolUse', session_id: 'S1', cwd: '/w/proj', tool_name: 'Write', tool_use_id: 'tu1', tool_input: { content: 'x'.repeat(300 * 1024) } };
    const r = await run(home, JSON.stringify(big));
    expect(r.code).toBe(0);
    expect(r.out + r.err).toBe('');
    // a truncated body would be invalid JSON, rejected by the server, and never counted
    const s = store.snapshot().sessions.S1;
    expect(JSON.stringify(s)).toContain('Write');
  });
});
