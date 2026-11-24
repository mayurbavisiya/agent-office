import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startApp } from '../src/core/app.js';
import { runDemo } from '../tools/demo.js';

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

describe('demo mode', () => {
  it('demo with --sessions 3 --speed 50 produces 3 sessions with agents in the store within 2 s', async () => {
    const port = await freePort();
    const token = 'demo-tok';
    const app = await startApp({ port, token, configDir: mkdtempSync(join(tmpdir(), 'ao-cfg-')), claudeDir: mkdtempSync(join(tmpdir(), 'ao-claude-')), staticDir: mkdtempSync(join(tmpdir(), 'ao-static-')) });
    const ac = new AbortController();
    const done = runDemo({ port, token, sessions: 3, speed: 50, signal: ac.signal });
    try {
      const deadline = Date.now() + 2000;
      let ok = false;
      let cwds = new Set<string>();
      while (Date.now() < deadline && !ok) {
        const sessions = Object.values(app.store.snapshot().sessions);
        const withAgents = sessions.filter((s) => Object.keys(s.agents).length > 0);
        cwds = new Set(sessions.map((s) => s.cwd));
        ok = sessions.length === 3 && withAgents.length === 3 && cwds.size === 3;
        if (!ok) await new Promise((r) => setTimeout(r, 25));
      }
      expect(ok).toBe(true);
      for (const c of cwds) expect(c).toMatch(/^\/demo\/project-/);
    } finally {
      ac.abort();
      await done;
      await app.close();
    }
  });
});

describe('demo config', () => {
  it('resolves port and token from AGENT_OFFICE_DIR, with flags as overrides', async () => {
    const { resolveDemoConfig } = await import('../tools/demo.js');
    const dir = mkdtempSync(join(tmpdir(), 'ao-demo-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 51234, token: 'tok' }));
    expect(resolveDemoConfig([], { AGENT_OFFICE_DIR: dir })).toEqual({ port: 51234, token: 'tok' });
    expect(resolveDemoConfig(['--port', '9', '--token', 'x'], { AGENT_OFFICE_DIR: dir })).toEqual({ port: 9, token: 'x' });
  });
});
