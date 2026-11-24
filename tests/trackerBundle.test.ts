import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const root = join(import.meta.dirname, '..');
// the spawn tests run the committed bundle; the build goes to a temp dir and is compared with it
const committed = join(root, 'plugin', 'tracker');
const bundle = join(committed, 'tracker.mjs');
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

/** Every file under `dir`, relative, sorted. */
function files(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, join(rel, e.name)) : [join(rel, e.name)]))
    .sort();
}

function launch(dir: string, args: string[] = ['--started-by', 'plugin']): ChildProcess {
  const p = spawn('node', [bundle, ...args], { env: { ...process.env, AGENT_OFFICE_DIR: dir, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'ao-cl-')) }, stdio: 'ignore' });
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
  let built = '';
  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'ao-build-'));
    const scene = join(tmp, 'scene-dist');
    built = join(tmp, 'tracker');
    execFileSync('npx', ['tsx', 'tools/build-scene.ts', '--out', scene], { cwd: root, stdio: 'ignore' });
    execFileSync('npx', ['tsx', 'tools/build-plugin.ts', '--scene', scene, '--out', built], { cwd: root, stdio: 'ignore' });
  }, 60000);

  it('the committed plugin/tracker matches a fresh build, byte for byte', () => {
    expect(files(built)).toEqual(files(committed));
    for (const f of files(committed)) {
      expect(readFileSync(join(built, f)).equals(readFileSync(join(committed, f))), f).toBe(true);
    }
  });

  it('targets node 20, the oldest the launcher accepts', () => {
    const src = readFileSync(join(root, 'tools', 'build-plugin.ts'), 'utf8');
    expect(src).toMatch(/target: 'node20'/);
    expect(readFileSync(join(root, 'plugin', 'scripts', 'launch-tracker.sh'), 'utf8')).toMatch(/20/);
  });

  it('a tracker started with no --started-by says serve', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-tr-'));
    const port = await freePort();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: 'tok' }));
    launch(dir, []);
    const st = await until(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Agent-Office-Token': 'tok' } });
      return r.status === 200 ? await r.json() : undefined;
    });
    expect(st.startedBy).toBe('serve');
  }, 20000);

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

  it('POST /shutdown stops a plugin tracker and removes its pid file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-tr-'));
    const port = await freePort();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: 'tok' }));
    const p = launch(dir);
    await until(async () => ((await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Agent-Office-Token': 'tok' } })).status === 200 ? true : undefined));
    const exited = new Promise((res) => p.on('exit', res));
    const r = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST', headers: { 'X-Agent-Office-Token': 'tok' } });
    expect(r.status).toBe(202);
    expect(await exited).toBe(0);
    expect(existsSync(join(dir, 'tracker.pid'))).toBe(false);
  }, 20000);
});
