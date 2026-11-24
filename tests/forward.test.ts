import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function run(home: string, stdin: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string; err: string; ms: number }>((resolveRun, reject) => {
    const t0 = Date.now();
    const base = { ...process.env };
    delete base.AGENT_OFFICE_DIR;
    const p = spawn('sh', [SCRIPT], { env: { ...base, HOME: home, ...env } });
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
    // blob first, session_id/cwd AFTER it: the session only exists with label 'tail-proj'
    // if the entire body arrived (the server parses the whole body before applying it)
    const body = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', pad: 'x'.repeat(300 * 1024), session_id: 'BIG-1', cwd: '/w/tail-proj' });
    expect(body.length).toBeGreaterThan(300 * 1024);
    const r = await run(homeWith({ port, token: TOKEN }), body);
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    const sessions = store.snapshot().sessions;
    expect(Object.keys(sessions)).toEqual(['BIG-1']);
    expect(sessions['BIG-1'].label).toBe('tail-proj');
  });

  it('honours AGENT_OFFICE_DIR for the config location', async () => {
    const { store, port } = await boot();
    const dir = mkdtempSync(join(tmpdir(), 'ao-dir-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: TOKEN }));
    const r = await run(homeWith(null), JSON.stringify(ev()), { AGENT_OFFICE_DIR: dir });
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(Object.keys(store.snapshot().sessions)).toContain('S1');
  });

  it('never puts the token on the curl command line', async () => {
    // a fake curl on PATH records its argv
    const bin = mkdtempSync(join(tmpdir(), 'ao-bin-'));
    const argv = join(bin, 'argv.txt');
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\ncat >/dev/null\nexit 0\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    const r = await run(homeWith({ port: 1, token: 'secret-token-xyz' }), JSON.stringify(ev()), { PATH: `${bin}:${process.env.PATH}` });
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(existsSync(argv)).toBe(true);
    const args = readFileSync(argv, 'utf8');
    expect(args).toContain('--max-time');
    expect(args).not.toContain('secret-token-xyz');
  });

  it('with a server that accepts but never responds, exits 0 within the curl timeout', async () => {
    const socks: Array<{ destroy(): void }> = [];
    const hung = createServer((sock) => { socks.push(sock); });
    await new Promise<void>((res) => hung.listen(0, '127.0.0.1', res));
    closers.push(() => new Promise<void>((res) => { hung.close(() => res()); socks.forEach((k) => k.destroy()); }));
    const port = (hung.address() as { port: number }).port;
    const r = await run(homeWith({ port, token: TOKEN }), JSON.stringify(ev()));
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(r.ms).toBeLessThan(2500);
  });
});
