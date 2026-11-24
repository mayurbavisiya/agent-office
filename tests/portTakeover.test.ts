import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import { startApp, type App } from '../src/core/app.js';
import { startOrTakeOver } from '../src/main/portTakeover.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!().catch(() => undefined);
});
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

const TOKEN = 'tk-takeover';
const staticDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'ao-tk-'));
  writeFileSync(join(d, 'index.html'), 'x');
  return d;
};

/** A real tracker on `port`; `onShutdown` closes it unless `stuck`. */
async function tracker(port: number, startedBy: 'plugin' | 'app' | 'serve', stuck = false): Promise<App> {
  let app: App | undefined;
  app = await startApp({
    port,
    token: TOKEN,
    claudeDir: mkdtempSync(join(tmpdir(), 'ao-cl-')),
    staticDir: staticDir(),
    startedBy,
    onShutdown: () => {
      if (!stuck) void app?.close();
    },
  });
  closers.push(() => app!.close());
  return app;
}

/** What the desktop app would start: an app-owned tracker on the same port. */
const startDesktop = (port: number) => async () => {
  const app = await startApp({ port, token: TOKEN, claudeDir: mkdtempSync(join(tmpdir(), 'ao-cl-')), staticDir: staticDir(), startedBy: 'app' });
  closers.push(() => app.close());
  return app;
};

const state = async (port: number) =>
  (await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Agent-Office-Token': TOKEN } })).json();

describe('startOrTakeOver', () => {
  it('starts straight away when the port is free', async () => {
    const port = await freePort();
    const r = await startOrTakeOver(startDesktop(port), () => ({ port, token: TOKEN }));
    expect('app' in r).toBe(true);
    expect((await state(port)).startedBy).toBe('app');
  });

  it('stops a plugin tracker on the port and starts in its place', async () => {
    const port = await freePort();
    await tracker(port, 'plugin');
    const r = await startOrTakeOver(startDesktop(port), () => ({ port, token: TOKEN }));
    expect('app' in r).toBe(true);
    expect((await state(port)).startedBy).toBe('app');
  }, 10000);

  it('leaves a tracker the app or serve started alone and reports the port in use', async () => {
    for (const by of ['app', 'serve'] as const) {
      const port = await freePort();
      await tracker(port, by);
      const r = await startOrTakeOver(startDesktop(port), () => ({ port, token: TOKEN }));
      expect(r).toMatchObject({ inUse: true });
      expect((await state(port)).startedBy).toBe(by);
    }
  }, 10000);

  it('reports the port in use when something else holds it', async () => {
    const port = await freePort();
    const other: Server = createServer((s) => s.destroy());
    await new Promise<void>((res) => other.listen(port, '127.0.0.1', () => res()));
    closers.push(() => new Promise((res) => other.close(() => res())));
    const t0 = Date.now();
    const r = await startOrTakeOver(startDesktop(port), () => ({ port, token: TOKEN }), { probeMs: 300 });
    expect(r).toMatchObject({ inUse: true });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('reports the port in use when a plugin tracker will not let go of it', async () => {
    const port = await freePort();
    await tracker(port, 'plugin', true);
    const t0 = Date.now();
    const r = await startOrTakeOver(startDesktop(port), () => ({ port, token: TOKEN }), { freeMs: 400 });
    expect(r).toMatchObject({ inUse: true });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect((await state(port)).startedBy).toBe('plugin');
  }, 10000);

  it('passes any other start failure through, not as port-in-use', async () => {
    let asked = false;
    const r = await startOrTakeOver(
      async () => {
        throw new Error('bad config');
      },
      () => {
        asked = true;
        return { port: 1, token: TOKEN };
      },
    );
    expect(r).toEqual({ error: 'bad config', inUse: false });
    expect(asked).toBe(false);
  });
});
