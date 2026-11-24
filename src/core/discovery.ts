import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { basename, dirname, join } from 'node:path';

export type DiscoveredSubagent = {
  agentId: string;
  path: string;
  /** meta.json `finished === true`; missing/unreadable meta means assume running. A parsed meta with no
   * `finished` key at all (a shape change) counts as finished once the log is STALE_AGENT_MS old. */
  finished: boolean;
  type?: string;
  description?: string;
  toolUseId?: string;
};

export type DiscoveredSession = {
  sessionId: string;
  cwd?: string;
  /** '' when a registry session's log was not found (yet) */
  mainLog: string;
  subagentLogs: DiscoveredSubagent[];
  /** from the session registry (docs/hook-notes.md "Session registry"); absent in the mtime fallback */
  pid?: number;
  name?: string;
  registryStatus?: 'busy' | 'idle';
  /** earlier session ids of the same process (formerNames[].sessionId), e.g. before /clear */
  formerSessionIds?: string[];
  procStart?: string;
};

/** One live `$CLAUDE_DIR/sessions/<pid>.json` entry. Internal/undocumented format: every field optional. */
export type RegistryEntry = {
  pid: number;
  sessionId: string;
  cwd?: string;
  name?: string;
  status?: 'busy' | 'idle';
  procStart?: string;
  formerSessionIds: string[];
};

/** `<session-dir>/subagents/agent-<agentId>.jsonl`, where session-dir is the transcript path without `.jsonl`. */
export function subagentLogPath(_claudeDir: string, transcriptPath: string, agentId: string): string {
  const sessionDir = join(dirname(transcriptPath), basename(transcriptPath).replace(/\.jsonl$/, ''));
  return join(sessionDir, 'subagents', `agent-${agentId}.jsonl`);
}

/** A subagent log untouched this long, whose meta has no `finished` key, is taken as finished. */
export const STALE_AGENT_MS = 600_000;

/** Reads the sibling `agent-<id>.meta.json`; never throws. `hasMeta`: the file was read and parsed. */
export function readMeta(logPath: string): Omit<DiscoveredSubagent, 'agentId' | 'path'> & { hasMeta?: boolean } {
  const out: Omit<DiscoveredSubagent, 'agentId' | 'path'> & { hasMeta?: boolean } = { finished: false };
  try {
    const o: unknown = JSON.parse(readFileSync(logPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    if (typeof o !== 'object' || o === null) return out;
    out.hasMeta = true;
    const m = o as Record<string, unknown>;
    if ('finished' in m) out.finished = m.finished === true;
    else {
      // the key is gone (format change): don't keep an old agent running forever
      try {
        out.finished = Date.now() - statSync(logPath).mtimeMs >= STALE_AGENT_MS;
      } catch {
        out.finished = false;
      }
    }
    if (typeof m.agentType === 'string') out.type = m.agentType;
    if (typeof m.description === 'string') out.description = m.description;
    if (typeof m.toolUseId === 'string') out.toolUseId = m.toolUseId;
  } catch {
    // missing or corrupt: assume running
  }
  return out;
}

const safeReaddir = (p: string): string[] => {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
};

/** `agent-<id>.jsonl` file names in `<session-dir>/subagents` (no meta read). */
export function listSubagentFiles(mainLog: string): Array<{ agentId: string; path: string }> {
  const subDir = join(dirname(mainLog), basename(mainLog).replace(/\.jsonl$/, ''), 'subagents');
  return safeReaddir(subDir)
    .map((f) => /^agent-(.+)\.jsonl$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ agentId: m[1], path: join(subDir, m[0]) }));
}

const subagentsOf = (mainLog: string): DiscoveredSubagent[] =>
  listSubagentFiles(mainLog).map((a) => {
    const { hasMeta: _h, ...meta } = readMeta(a.path);
    return { ...a, ...meta };
  });

/** True when the pid exists (EPERM: exists but owned by someone else). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const startCache = new Map<string, boolean>();
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
function psStart(pid: number, tz?: string): string | undefined {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
    if (tz) env.TZ = tz;
    const out = norm(execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Two `ps -o lstart` style start times (any spacing) within 2 s of each other. Fails open (true) when
 * either side is missing or unparseable: the pid check alone is then trusted.
 */
export function startTimesMatch(psOut: string | undefined, procStart: string): boolean {
  const a = Date.parse(norm(psOut ?? ''));
  const b = Date.parse(norm(procStart));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 2000;
}

/**
 * PID-reuse guard: does the process's start time match the registry's `procStart`? Claude Code writes
 * procStart in UTC (`ps -o lstart` format); local time is accepted too. If ps fails or a value does not
 * parse, the pid check is trusted. Cached per pid+procStart; `fresh` re-checks (and refreshes the cache).
 */
export function procStartMatches(pid: number, procStart: string, fresh = false): boolean {
  const key = `${pid}|${procStart}`;
  const hit = fresh ? undefined : startCache.get(key);
  if (hit !== undefined) return hit;
  const ok = startTimesMatch(psStart(pid, 'UTC'), procStart) || startTimesMatch(psStart(pid), procStart);
  startCache.set(key, ok);
  return ok;
}

/** Drops cached start-time checks for a pid (it died, so a reuse must be re-checked). */
export function forgetPid(pid: number): void {
  const prefix = `${pid}|`;
  for (const k of startCache.keys()) if (k.startsWith(prefix)) startCache.delete(k);
}

/**
 * Live interactive entries of `$CLAUDE_DIR/sessions/*.json` (never the `.key` files).
 * Returns null when the dir is missing, or when some entries parse as JSON but none has the expected shape
 * (numeric `pid`, string `sessionId`: the format changed); callers then fall back to the mtime scan. An
 * existing dir with no entries is an empty registry. An entry that fails to parse is skipped (it may be
 * half-written).
 */
export function readRegistry(claudeDir: string): RegistryEntry[] | null {
  const dir = join(claudeDir, 'sessions');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const out: RegistryEntry[] = [];
  let parsed = 0;
  let wellFormed = 0;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const o: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      parsed++;
      if (typeof o !== 'object' || o === null || Array.isArray(o)) continue;
      const m = o as Record<string, unknown>;
      const pid = m.pid;
      const sessionId = m.sessionId;
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof sessionId !== 'string' || !sessionId) continue;
      wellFormed++;
      if (m.kind !== undefined && m.kind !== 'interactive') continue;
      if (!pidAlive(pid)) {
        forgetPid(pid);
        continue;
      }
      const procStart = typeof m.procStart === 'string' && m.procStart ? m.procStart : undefined;
      if (procStart && !procStartMatches(pid, procStart)) continue;
      const e: RegistryEntry = { pid, sessionId, formerSessionIds: [] };
      if (procStart) e.procStart = procStart;
      if (typeof m.cwd === 'string' && m.cwd) e.cwd = m.cwd;
      if (typeof m.name === 'string' && m.name) e.name = m.name;
      if (m.status === 'busy' || m.status === 'idle') e.status = m.status;
      if (Array.isArray(m.formerNames)) {
        for (const fn of m.formerNames as unknown[]) {
          const id = typeof fn === 'object' && fn !== null ? (fn as { sessionId?: unknown }).sessionId : undefined;
          if (typeof id === 'string' && id && id !== sessionId) e.formerSessionIds.push(id);
        }
      }
      out.push(e);
    } catch {
      // unreadable or garbage: skip
    }
  }
  return parsed > 0 && wellFormed === 0 ? null : out;
}

/** `<sessionId>.jsonl` in any project dir; tries the slug derived from cwd first. */
export function findMainLog(claudeDir: string, sessionId: string, cwd?: string): string | undefined {
  const projects = join(claudeDir, 'projects');
  const file = `${sessionId}.jsonl`;
  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (cwd) {
    const p = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), file);
    if (isFile(p)) return p;
  }
  for (const slug of safeReaddir(projects)) {
    const p = join(projects, slug, file);
    if (isFile(p)) return p;
  }
  return undefined;
}

/** A DiscoveredSession for a registry entry (log located, subagents listed with their meta). */
export function sessionFromRegistry(claudeDir: string, r: RegistryEntry): DiscoveredSession {
  const mainLog = findMainLog(claudeDir, r.sessionId, r.cwd) ?? '';
  const s: DiscoveredSession = { sessionId: r.sessionId, mainLog, subagentLogs: mainLog ? subagentsOf(mainLog) : [], pid: r.pid, formerSessionIds: r.formerSessionIds };
  const cwd = r.cwd ?? (mainLog ? findCwd(mainLog) : undefined);
  if (cwd) s.cwd = cwd;
  if (r.name) s.name = r.name;
  if (r.status) s.registryStatus = r.status;
  if (r.procStart) s.procStart = r.procStart;
  return s;
}

/** First top-level `cwd` in the file; reads 64 KB blocks only until one is found (bounded at 1 MB). */
function findCwd(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    let carry = '';
    const dec = new StringDecoder('utf8');
    while (pos < 1024 * 1024) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      const parts = (carry + dec.write(buf.subarray(0, n))).split('\n');
      carry = parts.pop() ?? '';
      for (const l of parts) {
        if (!l.includes('"cwd"')) continue;
        try {
          const o: unknown = JSON.parse(l);
          if (typeof o === 'object' && o !== null && typeof (o as { cwd?: unknown }).cwd === 'string') return (o as { cwd: string }).cwd;
        } catch {
          // skip bad line
        }
      }
    }
    if (carry.includes('"cwd"')) {
      try {
        const o = JSON.parse(carry) as { cwd?: unknown };
        if (typeof o.cwd === 'string') return o.cwd;
      } catch {
        // ignore
      }
    }
  } catch {
    // unreadable
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}

/**
 * Every running session: from the session registry when it exists (all live interactive entries, whatever
 * their log age; none when the sessions dir exists but is empty), else main logs modified within `windowMs`.
 */
export function discoverActiveSessions(claudeDir: string, now: number, windowMs = 600_000): DiscoveredSession[] {
  const reg = readRegistry(claudeDir);
  if (reg) return reg.map((r) => sessionFromRegistry(claudeDir, r));
  return recentMainLogs(claudeDir, now, windowMs).map((l) => sessionFromLog(l.sessionId, l.mainLog));
}

/** A DiscoveredSession for a main log found by the mtime scan. */
export function sessionFromLog(sessionId: string, mainLog: string): DiscoveredSession {
  const s: DiscoveredSession = { sessionId, mainLog, subagentLogs: subagentsOf(mainLog) };
  const cwd = findCwd(mainLog);
  if (cwd) s.cwd = cwd;
  return s;
}

/** Main logs whose mtime is within windowMs (stat only). */
export function recentMainLogs(claudeDir: string, now: number, windowMs = 600_000): Array<{ sessionId: string; mainLog: string }> {
  const out: Array<{ sessionId: string; mainLog: string }> = [];
  const projects = join(claudeDir, 'projects');
  for (const slug of safeReaddir(projects)) {
    const projDir = join(projects, slug);
    for (const name of safeReaddir(projDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const mainLog = join(projDir, name);
      try {
        const st = statSync(mainLog);
        if (!st.isFile() || now - st.mtimeMs > windowMs) continue;
      } catch {
        continue;
      }
      out.push({ sessionId: name.slice(0, -'.jsonl'.length), mainLog });
    }
  }
  return out;
}
