import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type DiscoveredSession = {
  sessionId: string;
  cwd?: string;
  mainLog: string;
  subagentLogs: { agentId: string; path: string }[];
};

/** `<session-dir>/subagents/agent-<agentId>.jsonl`, where session-dir is the transcript path without `.jsonl`. */
export function subagentLogPath(_claudeDir: string, transcriptPath: string, agentId: string): string {
  const sessionDir = join(dirname(transcriptPath), basename(transcriptPath).replace(/\.jsonl$/, ''));
  return join(sessionDir, 'subagents', `agent-${agentId}.jsonl`);
}

const safeReaddir = (p: string): string[] => {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
};

/** First top-level `cwd` in the file; reads 64 KB blocks only until one is found (bounded at 1 MB). */
function findCwd(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    let carry = '';
    while (pos < 1024 * 1024) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      const parts = (carry + buf.toString('utf8', 0, n)).split('\n');
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

export function discoverActiveSessions(claudeDir: string, now: number, windowMs = 600_000): DiscoveredSession[] {
  const out: DiscoveredSession[] = [];
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
      const sessionId = name.slice(0, -'.jsonl'.length);
      const subDir = join(projDir, sessionId, 'subagents');
      const subagentLogs = safeReaddir(subDir)
        .map((f) => /^agent-(.+)\.jsonl$/.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ agentId: m[1], path: join(subDir, m[0]) }));
      const s: DiscoveredSession = { sessionId, mainLog, subagentLogs };
      const cwd = findCwd(mainLog);
      if (cwd) s.cwd = cwd;
      out.push(s);
    }
  }
  return out;
}
