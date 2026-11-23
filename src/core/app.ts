import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir as defaultClaudeDir, loadOrCreateConfig } from '../shared/config.js';
import type { HookEvent } from '../shared/types.js';
import { startEventServer } from '../server/eventServer.js';
import { discoverActiveSessions, subagentLogPath } from './discovery.js';
import { LogWatcher } from './logWatcher.js';
import type { LogDelta } from './logParser.js';
import { OfficeStore } from './store.js';

export type App = { url: string; store: OfficeStore; close(): Promise<void> };

/** `seen`: the session/agent has existed in the store at least once. Only then does its absence mean "pruned"
 * (a discovered subagent has no store entry until its first delta, so absence alone proves nothing). */
type Tracked = { sessionId: string; agentId: string | null; seen: boolean };

/** `<repo>/dist/scene`, relative to this file (src/core or dist/core). */
const defaultStaticDir = () => join(fileURLToPath(new URL('../..', import.meta.url)), 'dist', 'scene');

export async function startApp(opts: { port?: number; token?: string; claudeDir?: string; staticDir?: string; configDir?: string } = {}): Promise<App> {
  const cfg = opts.port !== undefined && opts.token !== undefined ? { port: opts.port, token: opts.token } : loadOrCreateConfig(opts.configDir);
  const port = opts.port ?? cfg.port;
  const token = opts.token ?? cfg.token;
  const cdir = opts.claudeDir ?? defaultClaudeDir();

  const store = new OfficeStore();
  const watcher = new LogWatcher();
  /** every log path ever watched; never watched twice */
  const tracked = new Map<string, Tracked>();
  /** paths of pruned agents/sessions: never watched again */
  const dropped = new Set<string>();
  const transcripts = new Map<string, string>();

  watcher.on('delta', (sid: string, aid: string | null, d: LogDelta) => store.applyLog(sid, aid, d, Date.now()));

  const watchLog = (sessionId: string, agentId: string | null, path: string | undefined): void => {
    if (!path || tracked.has(path) || dropped.has(path)) return;
    tracked.set(path, { sessionId, agentId, seen: false });
    watcher.watch(sessionId, agentId, path, { fromStart: true });
  };

  /** Unwatch (forever) the logs of agents and sessions the store has pruned. Ended sessions keep being watched until pruned. */
  const syncWatches = (): void => {
    const sessions = store.snapshot().sessions;
    for (const [path, t] of tracked) {
      const s = sessions[t.sessionId];
      const present = !!s && (!t.agentId || !!s.agents[t.agentId]);
      if (present) {
        t.seen = true;
      } else if (t.seen) {
        watcher.unwatch(path);
        tracked.delete(path);
        dropped.add(path);
      }
    }
  };
  store.onChange(syncWatches);

  // seed from sessions that were already running
  const now = Date.now();
  try {
    for (const d of discoverActiveSessions(cdir, now)) {
      store.applyHook({ hook_event_name: 'SessionStart', source: 'discovered', session_id: d.sessionId, cwd: d.cwd }, now);
      transcripts.set(d.sessionId, d.mainLog);
      watchLog(d.sessionId, null, d.mainLog);
      for (const a of d.subagentLogs) watchLog(d.sessionId, a.agentId, a.path);
    }
  } catch {
    // discovery is best effort
  }

  const watchFromHook = (e: HookEvent): void => {
    try {
      if (typeof e.transcript_path === 'string' && e.transcript_path && typeof e.session_id === 'string' && !transcripts.has(e.session_id)) {
        transcripts.set(e.session_id, e.transcript_path);
        watchLog(e.session_id, null, e.transcript_path);
      }
      const tp = transcripts.get(e.session_id);
      if (e.hook_event_name === 'SubagentStart' && e.agent_id && tp) {
        watchLog(e.session_id, e.agent_id, subagentLogPath(cdir, tp, e.agent_id));
      } else if (e.hook_event_name === 'SubagentStop' && e.agent_id) {
        const p = e.agent_transcript_path ?? (tp ? subagentLogPath(cdir, tp, e.agent_id) : undefined);
        watchLog(e.session_id, e.agent_id, p);
      }
    } catch {
      // never let log wiring break hook handling
    }
  };

  // The server calls store.applyHook; watch logs after the store has seen the hook.
  const origApply = store.applyHook.bind(store);
  store.applyHook = (e, t) => {
    const out = origApply(e, t);
    watchFromHook(e);
    return out;
  };

  const tick = setInterval(() => store.tick(Date.now()), 1000);
  let server: Awaited<ReturnType<typeof startEventServer>>;
  try {
    server = await startEventServer({ port, token, store, staticDir: opts.staticDir ?? defaultStaticDir() });
  } catch (err) {
    clearInterval(tick);
    watcher.close();
    throw err;
  }

  return {
    url: server.url,
    store,
    async close() {
      clearInterval(tick);
      watcher.close();
      await server.close();
    },
  };
}
