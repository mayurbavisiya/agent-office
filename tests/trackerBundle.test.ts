import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const root = join(import.meta.dirname, '..');
const bundle = join(root, 'plugin', 'tracker', 'tracker.mjs');
const procs: ChildProcess[] = [];
afterEach(() => {
  while (procs.length) procs.pop()!.kill();
});
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

function launch(dir: string): ChildProcess {
  const p = spawn('node', [bundle, '--started-by', 'plugin'], { env: { ...process.env, AGENT_OFFICE_DIR: dir, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'ao-cl-')) }, stdio: 'ignore' });
  procs.push(p);
  return p;
}
async function until<T>(f: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('tracker bundle', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build:scene'], { cwd: root, stdio: 'ignore' });
    execFileSync('npm', ['run', 'build:plugin'], { cwd: root, stdio: 'ignore' });
  }, 60000);

  it('runs under plain node', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-tr-'));
    const port = await freePort();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: 'tok' }));
    launch(dir);
    const base = `http://127.0.0.1:${port}`;
    const st = await until(async () => {
      const r = await fetch(`${base}/state`, { headers: { 'X-Agent-Office-Token': 'tok' } });
      return r.status === 200 ? await r.json() : undefined;
    });
    expect(st.startedBy).toBe('plugin');
    expect(st.version).toBe(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
    expect(existsSync(join(dir, 'tracker.pid'))).toBe(true);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<html');
  }, 20000);

  it('second tracker on the same port exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-tr-'));
    const port = await freePort();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: 'tok' }));
    launch(dir);
    await until(async () => ((await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Agent-Office-Token': 'tok' } })).status === 200 ? true : undefined));
    const second = launch(dir);
    const code = await new Promise((res) => second.on('exit', res));
    expect(code).toBe(0);
  }, 20000);
});
