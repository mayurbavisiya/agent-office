import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const root = join(import.meta.dirname, '..');
const plugin = join(root, 'plugin');
const script = join(plugin, 'scripts', 'launch-tracker.sh');
const started: number[] = [];
afterEach(() => {
  while (started.length) {
    try {
      process.kill(started.pop()!, 'SIGTERM');
    } catch {
      // already gone
    }
  }
});
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** a PATH holding only the tools the launcher needs besides node */
function pathWithout(): string {
  const bin = mkdtempSync(join(tmpdir(), 'ao-bin-'));
  for (const tool of ['nohup', 'sed', 'cut', 'head', 'cat', 'tr']) {
    const which = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (which) symlinkSync(which, join(bin, tool));
  }
  return bin;
}
function fakeNode(version: string): string {
  const bin = pathWithout();
  writeFileSync(join(bin, 'node'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return bin;
}

describe('launch-tracker.sh', () => {
  it('exits 3 when node is missing', () => {
    const r = spawnSync('/bin/sh', [script, plugin], { env: { PATH: pathWithout(), HOME: tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(3);
  });

  it('exits 3 when node is older than v20', () => {
    const r = spawnSync('/bin/sh', [script, plugin], { env: { PATH: fakeNode('v18.19.0'), HOME: tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(3);
  });

  it('starts the tracker detached and prints its pid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-ln-'));
    const port = await freePort();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port, token: 'tok' }));
    const t0 = Date.now();
    const r = spawnSync('/bin/sh', [script, plugin], {
      env: { ...process.env, AGENT_OFFICE_DIR: dir, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'ao-cl-')) },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
    const pid = Number(r.stdout.trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    started.push(pid);
    expect(alive(pid)).toBe(true);
    let st = 0;
    for (let i = 0; i < 100 && st !== 200; i++) {
      st = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Agent-Office-Token': 'tok' } }).then((x) => x.status, () => 0);
      if (st !== 200) await new Promise((res) => setTimeout(res, 50));
    }
    expect(st).toBe(200);
    expect(r.stdout + r.stderr).not.toContain('tok');
  }, 20000);
});
