import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { request } from 'node:http';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { OfficeStore } from '../src/core/store.js';
import { startEventServer } from '../src/server/eventServer.js';
import { subagentLogPath } from '../src/core/discovery.js';
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
  const FIXLOGS = join(__dirname, 'fixtures/logs/single-subagent');
  const SID = 'f9e58de5-4a17-4ce3-b430-e3d054dfb702';
  const AID = 'a1c6ea8b5593d9948';

  async function until(cond: () => boolean, ms = 8000): Promise<void> {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const assistantLine = (id: string, out: number) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), gitBranch: 'feat', cwd: '/w/app', message: { id, model: 'claude-sonnet-4-5', role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: out } } }) + '\n';

  function claudeHome(copyFixture = false): { home: string; proj: string } {
    const home = mkdtempSync(join(tmpdir(), 'ao-claude-'));
    const proj = join(home, 'projects', 'slug');
    mkdirSync(proj, { recursive: true });
    if (copyFixture) cpSync(FIXLOGS, proj, { recursive: true });
    return { home, proj };
  }

  async function bootApp(home: string) {
    const port = await freePort();
    const app = await startApp({ port, token: TOKEN, claudeDir: home, configDir: mkdtempSync(join(tmpdir(), 'ao-cfg-')), staticDir: staticDir() });
    closers.push(() => app.close());
    return { port, app };
  }

  it('(a) discovered session: main and unfinished subagent logs replay into the store, even after other store changes', async () => {
    const { home, proj } = claudeHome(true);
    // make the subagent log long so its first delta lands well after the main log's (which changes the store first)
    const subLog = join(proj, SID, 'subagents', `agent-${AID}.jsonl`);
    const mp = join(proj, SID, 'subagents', `agent-${AID}.meta.json`);
    writeFileSync(mp, JSON.stringify({ ...JSON.parse(readFileSync(mp, 'utf8')), finished: false }));
    writeFileSync(subLog, '{"type":"noise"}\n'.repeat(60000) + readFileSync(subLog, 'utf8'));
    const { port, app } = await bootApp(home);
    // unrelated store changes before the subagent's first delta must not drop its log
    await post(port, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'OTHER', cwd: '/w/x' }), auth);
    await post(port, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'OTHER', cwd: '/w/x' }), auth);
    await until(() => {
      const s = app.store.snapshot().sessions[SID];
      const a = s?.agents[AID];
      return !!s && s.boss.stats.outputTokens > 0 && !!a && a.stats.outputTokens > 0;
    });
    expect(app.store.snapshot().sessions[SID]!.cwd).toBe('/scratch/ao');
  });

  it('startApp does not show finished discovered subagents', async () => {
    const { home, proj } = claudeHome(true);
    const subs = join(proj, SID, 'subagents');
    const metaPath = join(subs, `agent-${AID}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    // AID stays finished; a second, unfinished copy
    const RUN = 'arunning0000000001';
    cpSync(join(subs, `agent-${AID}.jsonl`), join(subs, `agent-${RUN}.jsonl`));
    writeFileSync(join(subs, `agent-${RUN}.meta.json`), JSON.stringify({ ...meta, finished: false, agentType: 'Plan', description: 'still going' }));
    const { app } = await bootApp(home);
    await until(() => (app.store.snapshot().sessions[SID]?.agents[RUN]?.stats.outputTokens ?? 0) > 0);
    const agents = app.store.snapshot().sessions[SID]!.agents;
    expect(Object.keys(agents)).toEqual([RUN]);
    expect(agents[RUN].type).toBe('Plan');
    expect(agents[RUN].task).toBe('still going');
    expect(app.watchedPaths()).not.toContain(join(subs, `agent-${AID}.jsonl`));
    expect(app.watchedPaths()).toContain(join(subs, `agent-${RUN}.jsonl`));
  });

  it('(b) subagent log that appears after SubagentStart is attached', async () => {
    const { home, proj } = claudeHome();
    const tp = join(proj, 'S3.jsonl');
    writeFileSync(tp, assistantLine('b1', 5));
    const { port, app } = await bootApp(home);
    const send = (e: object) => post(port, JSON.stringify({ session_id: 'S3', cwd: '/w/app', transcript_path: tp, ...e }), auth);
    await send({ hook_event_name: 'SessionStart', source: 'startup' });
    await send({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
    const subDir = join(proj, 'S3', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-ag1.jsonl'), assistantLine('b2', 77));
    await until(() => (app.store.snapshot().sessions.S3?.agents.ag1?.stats.outputTokens ?? 0) === 77);
  });

  it('(c) a line written right before SessionEnd is still counted', async () => {
    const { home, proj } = claudeHome();
    const tp = join(proj, 'S4.jsonl');
    writeFileSync(tp, assistantLine('c1', 5));
    const { port, app } = await bootApp(home);
    const send = (e: object) => post(port, JSON.stringify({ session_id: 'S4', cwd: '/w/app', transcript_path: tp, ...e }), auth);
    await send({ hook_event_name: 'SessionStart', source: 'startup' });
    await until(() => app.store.snapshot().sessions.S4?.boss.stats.outputTokens === 5);
    appendFileSync(tp, assistantLine('c2', 7));
    await send({ hook_event_name: 'SessionEnd', reason: 'other' });
    await until(() => app.store.snapshot().sessions.S4?.boss.stats.outputTokens === 12);
    expect(app.store.snapshot().sessions.S4!.status).toBe('ended');
  });

  it('(d) logs of a pruned session are unwatched', async () => {
    const { home, proj } = claudeHome();
    const tp = join(proj, 'S5.jsonl');
    writeFileSync(tp, assistantLine('d1', 5));
    const { port, app } = await bootApp(home);
    const send = (e: object) => post(port, JSON.stringify({ session_id: 'S5', cwd: '/w/app', transcript_path: tp, ...e }), auth);
    await send({ hook_event_name: 'SessionStart', source: 'startup' });
    await until(() => app.store.snapshot().sessions.S5?.boss.stats.outputTokens === 5);
    await send({ hook_event_name: 'SessionEnd', reason: 'other' });
    app.store.tick(Date.now() + 3 * 3_600_000); // far future: session pruned from the snapshot
    expect(app.store.snapshot().sessions.S5).toBeUndefined();
    expect(app.watchedPaths()).not.toContain(tp);
    appendFileSync(tp, assistantLine('d2', 9));
    await new Promise((r) => setTimeout(r, 1500)); // > 1 poll interval
    expect(app.store.snapshot().sessions.S5).toBeUndefined();
  });

  it('(e) log of a pruned agent is unwatched while its session stays', async () => {
    const { home, proj } = claudeHome();
    const tp = join(proj, 'S6.jsonl');
    writeFileSync(tp, assistantLine('e1', 5));
    const { port, app } = await bootApp(home);
    const send = (e: object) => post(port, JSON.stringify({ session_id: 'S6', cwd: '/w/app', transcript_path: tp, ...e }), auth);
    await send({ hook_event_name: 'SessionStart', source: 'startup' });
    await send({ hook_event_name: 'SubagentStart', agent_id: 'ag6', agent_type: 'general-purpose' });
    const subLog = subagentLogPath(home, tp, 'ag6');
    mkdirSync(dirname(subLog), { recursive: true });
    writeFileSync(subLog, assistantLine('e2', 3));
    await until(() => (app.store.snapshot().sessions.S6?.agents.ag6?.stats.outputTokens ?? 0) === 3);
    expect(app.watchedPaths()).toContain(subLog);
    await send({ hook_event_name: 'SubagentStop', agent_id: 'ag6', agent_type: 'general-purpose' });
    app.store.tick(Date.now() + 10_000); // handing_off -> gone (6 s)
    app.store.tick(Date.now() + 80_000); // gone -> pruned (+60 s linger)
    const snap = app.store.snapshot().sessions.S6!;
    expect(snap.agents.ag6).toBeUndefined();
    expect(app.watchedPaths()).not.toContain(subLog);
    expect(app.watchedPaths()).toContain(tp);
  });

  it('(f) a discovered subagent that never yields a delta is unwatched once its session is pruned', async () => {
    const { home, proj } = claudeHome();
    const tp = join(proj, 'S8.jsonl');
    writeFileSync(tp, assistantLine('f1', 5));
    const subLog = join(proj, 'S8', 'subagents', 'agent-ghost.jsonl');
    mkdirSync(dirname(subLog), { recursive: true });
    writeFileSync(subLog, ''); // never yields a delta, so the agent never appears in the store
    const { port, app } = await bootApp(home);
    await until(() => app.store.snapshot().sessions.S8?.boss.stats.outputTokens === 5);
    expect(app.watchedPaths()).toContain(subLog);
    expect(app.store.snapshot().sessions.S8!.agents.ghost?.status).toBe('spawning'); // seeded from discovery (no meta.json: assume running)
    await post(port, JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'S8', reason: 'other' }), auth);
    app.store.tick(Date.now() + 3 * 3_600_000);
    expect(app.store.snapshot().sessions.S8).toBeUndefined();
    expect(app.watchedPaths()).toEqual([]);
  });
});
