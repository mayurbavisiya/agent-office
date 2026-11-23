import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { startApp, type App } from '../src/core/app.js';
import type { OfficeEvent } from '../src/shared/types.js';

const closers: Array<() => Promise<void> | void> = [];
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

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CWD = '/w/proj';
const line = (o: object) => JSON.stringify({ cwd: CWD, timestamp: new Date().toISOString(), ...o }) + '\n';

/** Temp claude dir with a registry entry for `pid` → `sid` and that session's main log. */
function home() {
  const dir = mkdtempSync(join(tmpdir(), 'ao-rescan-'));
  const proj = join(dir, 'projects', '-w-proj');
  mkdirSync(proj, { recursive: true });
  mkdirSync(join(dir, 'sessions'));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const register = (pid: number, sid: string, extra: object = {}) => {
    writeFileSync(join(proj, `${sid}.jsonl`), line({ type: 'user' }), { flag: 'a' });
    writeFileSync(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd: CWD, kind: 'interactive', ...extra }));
  };
  const subDir = (sid: string) => {
    const d = join(proj, sid, 'subagents');
    mkdirSync(d, { recursive: true });
    return d;
  };
  return { dir, proj, register, subDir };
}

async function boot(claudeDir: string): Promise<{ app: App; events: OfficeEvent[] }> {
  const port = await freePort();
  const app = await startApp({
    port,
    token: 'tok',
    claudeDir,
    configDir: mkdtempSync(join(tmpdir(), 'ao-cfg-')),
    staticDir: mkdtempSync(join(tmpdir(), 'ao-static-')),
    rescanMs: 50,
  });
  closers.push(() => app.close());
  const events: OfficeEvent[] = [];
  app.store.onChange((e) => events.push(...e));
  return { app, events };
}

function spawnSleeper(): ChildProcess {
  const c = spawn('sleep', ['30'], { stdio: 'ignore' });
  closers.push(() => {
    c.kill();
  });
  return c;
}

describe('rescan', () => {
  it('rescan adds a subagent that appears after startup', async () => {
    const h = home();
    h.register(process.pid, 'S1', { name: 'my-task' });
    const { app } = await boot(h.dir);
    expect(app.store.snapshot().sessions.S1?.name).toBe('my-task');
    const d = h.subDir('S1');
    writeFileSync(join(d, 'agent-x.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the bug', finished: false }));
    writeFileSync(join(d, 'agent-x.jsonl'), line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 3 } } }));
    await until(() => app.store.snapshot().sessions.S1?.agents.x?.status === 'working');
    const a = app.store.snapshot().sessions.S1!.agents.x;
    expect(a.task).toBe('Find the bug');
    expect(a.type).toBe('Explore');
    expect(app.watchedPaths()).toContain(join(d, 'agent-x.jsonl'));
  });

  it('rescan marks a subagent done when meta.json finishes', async () => {
    const h = home();
    h.register(process.pid, 'S1');
    const d = h.subDir('S1');
    writeFileSync(join(d, 'agent-y.jsonl'), line({ type: 'user' }));
    writeFileSync(join(d, 'agent-y.meta.json'), JSON.stringify({ agentType: 'Plan', description: 'plan it', finished: false }));
    const { app, events } = await boot(h.dir);
    expect(app.store.snapshot().sessions.S1?.agents.y).toBeDefined();
    writeFileSync(join(d, 'agent-y.meta.json'), JSON.stringify({ agentType: 'Plan', description: 'plan it', finished: true }));
    await until(() => app.store.snapshot().sessions.S1?.agents.y?.status === 'handing_off');
    await sleep(200);
    expect(events.filter((e) => e.kind === 'handoff')).toHaveLength(1);
  });

  it('rescan turns a changed sessionId for the same pid into a shift change, not a new room', async () => {
    const h = home();
    h.register(process.pid, 'OLD', { name: 'before', status: 'idle' });
    const { app, events } = await boot(h.dir);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['OLD']);
    h.register(process.pid, 'NEW', { name: 'after', status: 'idle', formerNames: [{ name: 'before', sessionId: 'OLD' }] });
    await until(() => !!app.store.snapshot().sessions.NEW);
    await sleep(200);
    const s = app.store.snapshot().sessions;
    expect(Object.keys(s)).toEqual(['NEW']);
    expect(s.NEW.name).toBe('after');
    expect(s.NEW.status).toBe('active');
    expect(events).toContainEqual({ kind: 'shift_change', fromSessionId: 'OLD', toSessionId: 'NEW' });
  });

  it('rescan ends a session whose pid is gone', async () => {
    const h = home();
    const child = spawnSleeper();
    h.register(child.pid!, 'GONE');
    h.register(process.pid, 'STAYS');
    const { app } = await boot(h.dir);
    expect(app.store.snapshot().sessions.GONE?.status).toBe('active');
    child.kill();
    await until(() => app.store.snapshot().sessions.GONE?.status === 'ended');
    expect(app.store.snapshot().sessions.STAYS.status).toBe('active');
  });

  it('a session started after the app gets a room', async () => {
    const h = home();
    const { app } = await boot(h.dir);
    h.register(process.pid, 'LATE', { name: 'late-one' });
    await until(() => app.store.snapshot().sessions.LATE?.name === 'late-one');
  });

  it('hooks and rescan do not duplicate an agent', async () => {
    const h = home();
    h.register(process.pid, 'S1');
    const { app, events } = await boot(h.dir);
    app.store.applyHook({ hook_event_name: 'SubagentStart', session_id: 'S1', agent_id: 'z', agent_type: 'Explore' }, Date.now());
    const d = h.subDir('S1');
    writeFileSync(join(d, 'agent-z.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look', finished: false }));
    writeFileSync(join(d, 'agent-z.jsonl'), line({ type: 'user' }));
    await until(() => app.watchedPaths().includes(join(d, 'agent-z.jsonl')));
    await sleep(200);
    expect(Object.keys(app.store.snapshot().sessions.S1!.agents)).toEqual(['z']);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['S1']);
    expect(events.filter((e) => e.kind === 'spawned')).toHaveLength(1);
  });

  it('registry busy/idle drives the boss only until real hooks arrive', async () => {
    const h = home();
    h.register(process.pid, 'S1', { status: 'idle' });
    const { app } = await boot(h.dir);
    h.register(process.pid, 'S1', { status: 'busy' });
    await until(() => app.store.snapshot().sessions.S1?.boss.status === 'working');
    h.register(process.pid, 'S1', { status: 'idle' });
    await until(() => app.store.snapshot().sessions.S1?.boss.status === 'idle');
    app.store.applyHook({ hook_event_name: 'Notification', session_id: 'S1', notification_type: 'permission_prompt' }, Date.now());
    h.register(process.pid, 'S1', { status: 'busy' });
    await sleep(250);
    expect(app.store.snapshot().sessions.S1!.boss.status).toBe('needs_you');
  });

  it('closing the last registry session ends it and does not revive old logs', async () => {
    const h = home();
    const child = spawnSleeper();
    h.register(child.pid!, 'LAST');
    const { app } = await boot(h.dir);
    // a recent main log of a session that is not running (in the mtime window, not in the registry)
    writeFileSync(join(h.proj, 'DEAD.jsonl'), line({ type: 'user' }));
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['LAST']);
    child.kill();
    unlinkSync(join(h.dir, 'sessions', `${child.pid}.json`));
    await until(() => app.store.snapshot().sessions.LAST?.status === 'ended');
    await sleep(250);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['LAST']);
    // the sessions dir disappearing later does not switch to the mtime scan either
    rmSync(join(h.dir, 'sessions'), { recursive: true });
    await sleep(250);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['LAST']);
  });

  it('a corrupt registry read does not end a live session', async () => {
    const h = home();
    h.register(process.pid, 'S1', { status: 'busy' });
    const { app, events } = await boot(h.dir);
    expect(app.store.snapshot().sessions.S1?.boss.status).toBe('working');
    writeFileSync(join(h.dir, 'sessions', `${process.pid}.json`), '{"pid":');
    await sleep(250);
    h.register(process.pid, 'S1', { status: 'busy' });
    await sleep(250);
    const s = app.store.snapshot().sessions.S1!;
    expect(s.status).toBe('active');
    expect(s.boss.status).toBe('working');
    expect(events.filter((e) => e.kind === 'session_ended' || e.kind === 'session_started')).toEqual([]);
  });

  it('a changed sessionId whose old room is gone starts a new room without taking over another', async () => {
    const h = home();
    h.register(process.pid, 'OLD', { status: 'idle' });
    h.register(process.ppid, 'OTHER', { status: 'idle' });
    const { app, events } = await boot(h.dir);
    // OLD's room ends and is pruned; OTHER stays an idle room in the same cwd
    app.store.applyHook({ hook_event_name: 'SessionEnd', session_id: 'OLD', reason: 'other' }, Date.now());
    app.store.tick(Date.now() + 61_000);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['OTHER']);
    h.register(process.pid, 'NEW', { status: 'idle', formerNames: [{ sessionId: 'OLD' }] });
    await until(() => !!app.store.snapshot().sessions.NEW);
    expect(Object.keys(app.store.snapshot().sessions).sort()).toEqual(['NEW', 'OTHER']);
    expect(events.some((e) => e.kind === 'shift_change')).toBe(false);
  });

  it('a busy registry session that /clears keeps a working boss', async () => {
    const h = home();
    h.register(process.pid, 'OLD', { status: 'idle' });
    const { app } = await boot(h.dir);
    h.register(process.pid, 'NEW', { status: 'busy', formerNames: [{ sessionId: 'OLD' }] });
    await until(() => !!app.store.snapshot().sessions.NEW);
    expect(Object.keys(app.store.snapshot().sessions)).toEqual(['NEW']);
    expect(app.store.snapshot().sessions.NEW.boss.status).toBe('working');
  });

  it('a room restarted from the registry watches its log again even after it was pruned', async () => {
    const h = home();
    const child = spawnSleeper();
    h.register(child.pid!, 'RES');
    const { app } = await boot(h.dir);
    const log = join(h.proj, 'RES.jsonl');
    expect(app.watchedPaths()).toContain(log);
    child.kill();
    await until(() => app.store.snapshot().sessions.RES?.status === 'ended');
    app.store.tick(Date.now() + 61_000);
    expect(app.store.snapshot().sessions.RES).toBeUndefined();
    expect(app.watchedPaths()).not.toContain(log);
    // resumed in a new process with the same session id
    h.register(process.pid, 'RES');
    await until(() => app.store.snapshot().sessions.RES?.status === 'active');
    await until(() => app.watchedPaths().includes(log));
  });
});

