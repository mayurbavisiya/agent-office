import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir as defaultClaudeDir, loadOrCreateConfig } from '../shared/config.js';
import type { AgentStatus, HookEvent } from '../shared/types.js';
import { startEventServer, type StartedBy } from '../server/eventServer.js';
import {
  discoverActiveSessions,
  findMainLog,
  forgetPid,
  listSubagentFiles,
  pidAlive,
  procStartMatches,
  readMeta,
  readRegistry,
  recentMainLogs,
  sessionFromLog,
  sessionFromRegistry,
  subagentLogPath,
  type DiscoveredSession,
} from './discovery.js';
import { LogWatcher } from './logWatcher.js';
import type { LogDelta } from './logParser.js';
import { OfficeStore } from './store.js';

export type App = { url: string; store: OfficeStore; watchedPaths(): string[]; clientCount(): number; close(): Promise<void> };

/** `seen`: the session/agent has existed in the store at least once. Only then does its absence mean "pruned"
 * (a discovered subagent has no store entry until its first delta, so absence alone proves nothing). */
type Tracked = { sessionId: string; agentId: string | null; seen: boolean };

/** What the rescan last saw of a session it reconciles. */
type Known = { pid?: number; procStart?: string; status?: 'busy' | 'idle'; name?: string };
/** A subagent log the rescan has seen: `finished` per meta.json; `typed` once meta gave type/description. */
type KnownAgent = { finished: boolean; typed: boolean };

const RUNNING: ReadonlySet<AgentStatus> = new Set(['spawning', 'working', 'quiet']);

/** `<repo>/dist/scene`, relative to this file (src/core or dist/core). */
const defaultStaticDir = () => join(fileURLToPath(new URL('../..', import.meta.url)), 'dist', 'scene');

export async function startApp(opts: { port?: number; token?: string; claudeDir?: string; staticDir?: string; configDir?: string; rescanMs?: number; version?: string; startedBy?: StartedBy; onShutdown?: () => void } = {}): Promise<App> {
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
    // a session already seen and pruned never sends another change: drop the watch now rather than leak it
    syncWatches();
  };

  const seenSessions = new Set<string>();
  /** Unwatch (forever) the logs of pruned agents and sessions. Ended sessions keep being watched until pruned.
   * A session seen once and now absent drops every path under it (even agents never seen); an agent seen once
   * and now absent drops its own path. */
  const syncWatches = (): void => {
    const sessions = store.peek();
    for (const [path, t] of tracked) {
      const s = sessions[t.sessionId];
      if (s) {
        seenSessions.add(t.sessionId);
        if (!t.agentId || s.agents[t.agentId]) {
          t.seen = true;
          continue;
        }
      }
      if (s ? t.seen : seenSessions.has(t.sessionId)) {
        watcher.unwatch(path);
        tracked.delete(path);
        dropped.add(path);
      }
    }
  };
  store.onChange(syncWatches);

  /** Synthetic events: applied straight to the store, not counted as real hooks (see the wrapper below). */
  const rawApply = store.applyHook.bind(store);
  const synth = (e: HookEvent): void => {
    rawApply(e, Date.now());
  };
  /** sessions that delivered at least one real hook: the registry no longer drives their boss */
  const hookSessions = new Set<string>();
  /** sessions the discovery/rescan has handled (never re-added once known) */
  const known = new Map<string, Known>();
  /** registry pid → its current session id */
  const pids = new Map<number, string>();
  /** subagent log path → what the rescan saw */
  const knownAgents = new Map<string, KnownAgent>();

  const seedAgent = (sessionId: string, agentId: string, path: string, meta: ReturnType<typeof readMeta>): void => {
    knownAgents.set(path, { finished: meta.finished, typed: !!(meta.hasMeta || meta.type || meta.description) });
    if (meta.finished) return; // finished before we saw it: neither shown nor watched (its tokens are not added to the team total)
    const s = store.snapshot().sessions[sessionId];
    if (s && s.status === 'active' && !s.agents[agentId]) {
      synth({ hook_event_name: 'SubagentStart', session_id: sessionId, agent_id: agentId, agent_type: meta.type, description: meta.description });
    }
    watchLog(sessionId, agentId, path);
  };

  /**
   * A new running session: room (unless hooks already made one), name, log watches, unfinished subagents.
   * `started`: the caller already started its room (a /clear takeover).
   */
  const addSession = (d: DiscoveredSession, started = false): void => {
    known.set(d.sessionId, { pid: d.pid, procStart: d.procStart, status: d.registryStatus, name: d.name });
    if (d.pid !== undefined) pids.set(d.pid, d.sessionId);
    const now = Date.now();
    const cur = store.snapshot().sessions[d.sessionId];
    // a live process whose room already ended (e.g. resumed in a new process) gets it back
    if (!cur || (cur.status === 'ended' && d.pid !== undefined)) {
      synth({ hook_event_name: 'SessionStart', source: 'discovered', session_id: d.sessionId, cwd: d.cwd });
      started = true;
    }
    if (started && d.registryStatus === 'busy' && !hookSessions.has(d.sessionId)) synth({ hook_event_name: 'UserPromptSubmit', session_id: d.sessionId });
    if (d.pid !== undefined) store.markLive(d.sessionId, now);
    store.setName(d.sessionId, d.name);
    if (d.mainLog) {
      if (!transcripts.has(d.sessionId)) transcripts.set(d.sessionId, d.mainLog);
      // a (re)started room watches its log even if an earlier prune dropped the path
      if (started) dropped.delete(d.mainLog);
      watchLog(d.sessionId, null, d.mainLog);
    }
    for (const a of d.subagentLogs) seedAgent(d.sessionId, a.agentId, a.path, a);
  };

  // seed from sessions that were already running
  try {
    for (const d of discoverActiveSessions(cdir, Date.now())) addSession(d);
  } catch {
    // discovery is best effort
  }

  /** New, finished or late-typed subagent logs of active sessions with a known log. Reads meta only for new/unfinished agents. */
  const rescanAgents = (): void => {
    const sessions = store.snapshot().sessions;
    for (const [sid, tp] of transcripts) {
      const s = sessions[sid];
      if (!s || s.status !== 'active') continue;
      for (const f of listSubagentFiles(tp)) {
        try {
          const k = knownAgents.get(f.path);
          if (k?.finished) continue;
          const meta = readMeta(f.path);
          if (!k) {
            seedAgent(sid, f.agentId, f.path, meta);
            continue;
          }
          const a = s.agents[f.agentId];
          if (!k.typed && meta.hasMeta) {
            k.typed = true;
            if (a && (meta.type || meta.description)) {
              synth({ hook_event_name: 'SubagentStart', session_id: sid, agent_id: f.agentId, agent_type: meta.type, description: meta.description });
            }
          }
          if (meta.finished) {
            k.finished = true;
            // only when the hooks path has not stopped it already
            if (a && RUNNING.has(a.status)) synth({ hook_event_name: 'SubagentStop', session_id: sid, agent_id: f.agentId, agent_type: meta.type });
          }
        } catch {
          // skip this agent this round
        }
      }
    }
  };

  /** a registry with at least one well-formed live entry was read (an empty dir proves nothing about its format) */
  let registrySeen = !!readRegistry(cdir)?.length;

  /** Re-reads the session registry (or the mtime window without one) and reconciles the store with it. Never throws. */
  const rescan = (): void => {
    try {
      // once a well-formed registry was seen, its later absence means "no sessions", never the mtime fallback
      const found = readRegistry(cdir);
      if (found?.length) registrySeen = true;
      const reg = found ?? (registrySeen ? [] : null);
      if (!reg) {
        for (const l of recentMainLogs(cdir, Date.now())) if (!known.has(l.sessionId)) addSession(sessionFromLog(l.sessionId, l.mainLog));
      } else {
        const now = Date.now();
        const live = new Set<number>();
        for (const r of reg) {
          live.add(r.pid);
          const k = known.get(r.sessionId);
          if (!k) {
            const prev = pids.get(r.pid);
            const old = prev !== undefined && prev !== r.sessionId ? prev : r.formerSessionIds.find((id) => known.has(id));
            const d = sessionFromRegistry(cdir, r);
            let started = false;
            if (old) {
              // same process, new session id: /clear. The start names the replaced room (`replaces`), so the
              // store hands exactly that room over (a shift change, not a second room) and never guesses
              // another room in the cwd. Without the old room there is nothing to hand over: a plain
              // discovered start.
              const cur = store.snapshot().sessions;
              known.delete(old);
              if (cur[old]?.status === 'active') synth({ hook_event_name: 'SessionEnd', session_id: old, reason: 'clear' });
              if (!cur[r.sessionId]) {
                synth(
                  cur[old]
                    ? { hook_event_name: 'SessionStart', source: 'clear', replaces: old, session_id: r.sessionId, cwd: d.cwd ?? cur[old].cwd }
                    : { hook_event_name: 'SessionStart', source: 'discovered', session_id: r.sessionId, cwd: d.cwd },
                );
                started = true;
              }
            }
            addSession(d, started);
            continue;
          }
          store.markLive(r.sessionId, now);
          if (r.procStart) k.procStart = r.procStart;
          if (k.pid !== r.pid) {
            if (k.pid !== undefined && pids.get(k.pid) === r.sessionId) pids.delete(k.pid);
            k.pid = r.pid;
            pids.set(r.pid, r.sessionId);
          }
          if (k.name !== r.name) {
            k.name = r.name;
            store.setName(r.sessionId, r.name);
          }
          if (r.status && r.status !== k.status) {
            // boss fallback for sessions that never sent a real hook
            if (!hookSessions.has(r.sessionId) && store.snapshot().sessions[r.sessionId]?.status === 'active') {
              synth({ hook_event_name: r.status === 'busy' ? 'UserPromptSubmit' : 'Stop', session_id: r.sessionId });
            }
            k.status = r.status;
          }
          if (!transcripts.has(r.sessionId)) {
            const tp = findMainLog(cdir, r.sessionId, r.cwd);
            if (tp) {
              transcripts.set(r.sessionId, tp);
              watchLog(r.sessionId, null, tp);
            }
          }
        }
        for (const [pid, sid] of pids) {
          if (live.has(pid)) continue;
          // missing from this read: end only if the process is really gone (a half-written file is skipped
          // by readRegistry), or the pid now belongs to another process
          const alive = pidAlive(pid);
          if (!alive) forgetPid(pid);
          const ps = known.get(sid)?.procStart;
          if (alive && !(ps && !procStartMatches(pid, ps, true))) continue;
          pids.delete(pid);
          known.delete(sid);
          if (store.snapshot().sessions[sid]?.status === 'active') synth({ hook_event_name: 'SessionEnd', session_id: sid, reason: 'other' });
        }
      }
      rescanAgents();
    } catch {
      // a rescan never throws
    }
  };

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

  // The server calls store.applyHook (real hooks); watch logs after the store has seen the hook.
  store.applyHook = (e, t) => {
    const out = rawApply(e, t);
    if (e && typeof e.session_id === 'string') hookSessions.add(e.session_id);
    watchFromHook(e);
    return out;
  };

  const tick = setInterval(() => store.tick(Date.now()), 1000);
  const rescanTimer = setInterval(rescan, opts.rescanMs ?? 3000);
  let server: Awaited<ReturnType<typeof startEventServer>>;
  try {
    server = await startEventServer({ port, token, store, staticDir: opts.staticDir ?? defaultStaticDir(), version: opts.version, startedBy: opts.startedBy, onShutdown: opts.onShutdown });
  } catch (err) {
    clearInterval(tick);
    clearInterval(rescanTimer);
    watcher.close();
    throw err;
  }

  return {
    url: server.url,
    store,
    watchedPaths: () => watcher.watchedPaths(),
    clientCount: () => server.clientCount(),
    async close() {
      clearInterval(tick);
      clearInterval(rescanTimer);
      watcher.close();
      await server.close();
    },
  };
}
