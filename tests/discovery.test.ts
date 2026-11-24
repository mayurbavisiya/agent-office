import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverActiveSessions, readMeta, readRegistry, startTimesMatch, subagentLogPath } from '../src/core/discovery.js';
import { claudeDir } from '../src/shared/config.js';

const FIX = join(__dirname, 'fixtures/logs');
const S1 = 'f9e58de5-4a17-4ce3-b430-e3d054dfb702';
const S2 = 'f3e506f6-5306-4684-8922-5c6fef869d3e';
const NOW = Date.now();
let root = '';
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

function build() {
  root = mkdtempSync(join(tmpdir(), 'disc-'));
  const proj = join(root, 'projects', 'proj-a');
  mkdirSync(proj, { recursive: true });
  cpSync(join(FIX, 'single-subagent'), proj, { recursive: true });
  cpSync(join(FIX, 'parallel-subagents'), proj, { recursive: true });
  const at = (p: string, ageMs: number) => utimesSync(p, new Date(NOW - ageMs), new Date(NOW - ageMs));
  at(join(proj, `${S1}.jsonl`), 60_000);
  at(join(proj, `${S2}.jsonl`), 30 * 60_000);
  return root;
}

describe('discoverActiveSessions', () => {
  it('returns sessions with main log mtime within 10 min, with their subagent logs; ignores older ones', () => {
    const r = discoverActiveSessions(build(), NOW);
    expect(r).toHaveLength(1);
    expect(r[0].sessionId).toBe(S1);
    expect(r[0].cwd).toBe('/scratch/ao');
    expect(r[0].mainLog).toBe(join(root, 'projects', 'proj-a', `${S1}.jsonl`));
    expect(r[0].subagentLogs).toEqual([
      {
        agentId: 'a1c6ea8b5593d9948',
        path: join(root, 'projects', 'proj-a', S1, 'subagents', 'agent-a1c6ea8b5593d9948.jsonl'),
        finished: true,
        type: 'Explore',
        description: 'List files in ao folder',
        toolUseId: 'toolu_017vHtXUyMcZpErpSwmsvLmW',
      },
    ]);
  });

  const subDir = (r: string) => join(r, 'projects', 'proj-a', S1, 'subagents');

  it('discovery marks subagent finished from meta.json', () => {
    const dir = build();
    expect(discoverActiveSessions(dir, NOW)[0].subagentLogs[0].finished).toBe(true);
    const meta = join(subDir(dir), 'agent-a1c6ea8b5593d9948.meta.json');
    const o = JSON.parse(readFileSync(meta, 'utf8'));
    writeFileSync(meta, JSON.stringify({ ...o, finished: false }));
    expect(discoverActiveSessions(dir, NOW)[0].subagentLogs[0].finished).toBe(false);
  });

  it('discovery tolerates missing/corrupt meta.json', () => {
    const dir = build();
    const meta = join(subDir(dir), 'agent-a1c6ea8b5593d9948.meta.json');
    writeFileSync(meta, '{not json');
    expect(discoverActiveSessions(dir, NOW)[0].subagentLogs[0]).toMatchObject({ finished: false });
    rmSync(meta);
    const l = discoverActiveSessions(dir, NOW)[0].subagentLogs[0];
    expect(l.finished).toBe(false);
    expect(l.type).toBeUndefined();
    writeFileSync(meta, '{}');
    expect(discoverActiveSessions(dir, NOW)[0].subagentLogs[0].finished).toBe(false);
  });

  it('honours a claudeDir passed from CLAUDE_CONFIG_DIR', () => {
    const dir = build();
    const r = discoverActiveSessions(claudeDir({ CLAUDE_CONFIG_DIR: dir }), NOW);
    expect(r.map((s) => s.sessionId)).toEqual([S1]);
  });

  it('reads a multi-byte cwd intact even when it straddles a 64 KB block boundary', () => {
    root = mkdtempSync(join(tmpdir(), 'disc-'));
    const proj = join(root, 'projects', 'p');
    mkdirSync(proj, { recursive: true });
    const cwd = '/ファイル/é';
    // pre is 65526 bytes, so the 64 KB boundary falls inside the first katakana of the cwd line
    const pre = '{"type":"x","pad":"' + 'a'.repeat(65504) + '"}\n';
    const lineBytes = Buffer.from(JSON.stringify({ cwd }) + '\n', 'utf8');
    writeFileSync(join(proj, 'abc.jsonl'), Buffer.concat([Buffer.from(pre), lineBytes]));
    expect(pre.length).toBe(65526);
    const r = discoverActiveSessions(root, Date.now());
    expect(r[0].cwd).toBe(cwd);
  });

  it('returns [] when the projects dir is missing', () => {
    expect(discoverActiveSessions(join(tmpdir(), 'nope-' + NOW), NOW)).toEqual([]);
  });

  it('discovery lists every live registry session regardless of log age', () => {
    root = mkdtempSync(join(tmpdir(), 'disc-'));
    const old = new Date(NOW - 2 * 86_400_000);
    const mk = (slug: string, sid: string, cwd: string) => {
      const proj = join(root, 'projects', slug);
      mkdirSync(join(proj, sid, 'subagents'), { recursive: true });
      const log = join(proj, `${sid}.jsonl`);
      writeFileSync(log, JSON.stringify({ type: 'user', cwd }) + '\n');
      utimesSync(log, old, old);
      return log;
    };
    const logA = mk('-w-alpha', 'sid-a', '/w/alpha');
    mk('other-slug', 'sid-b', '/w/beta');
    writeFileSync(join(root, 'projects', 'other-slug', 'sid-b', 'subagents', 'agent-x1.jsonl'), '{}\n');
    const reg = join(root, 'sessions');
    mkdirSync(reg);
    writeFileSync(join(reg, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sid-a', cwd: '/w/alpha', kind: 'interactive', name: 'alpha-work', status: 'busy' }));
    writeFileSync(join(reg, `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, sessionId: 'sid-b', cwd: '/w/beta', name: 'beta-work', status: 'idle' }));
    writeFileSync(join(reg, '999999.json'), JSON.stringify({ pid: 999999, sessionId: 'sid-dead', cwd: '/w/dead', kind: 'interactive' }));
    writeFileSync(join(reg, '1.json'), '{garbage');
    writeFileSync(join(reg, '999999.abc.key'), 'never read');
    const r = discoverActiveSessions(root, NOW).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(r.map((s) => s.sessionId)).toEqual(['sid-a', 'sid-b']);
    expect(r[0]).toMatchObject({ name: 'alpha-work', registryStatus: 'busy', cwd: '/w/alpha', mainLog: logA, pid: process.pid });
    expect(r[1]).toMatchObject({ name: 'beta-work', registryStatus: 'idle', cwd: '/w/beta', pid: process.ppid });
    expect(r[1].subagentLogs.map((a) => a.agentId)).toEqual(['x1']);
  });

  it('discovery skips non-interactive kinds and a pid whose start time does not match procStart', () => {
    root = mkdtempSync(join(tmpdir(), 'disc-'));
    mkdirSync(join(root, 'projects'), { recursive: true });
    const reg = join(root, 'sessions');
    mkdirSync(reg);
    writeFileSync(join(reg, 'a.json'), JSON.stringify({ pid: process.pid, sessionId: 'sid-bg', kind: 'background' }));
    writeFileSync(join(reg, 'b.json'), JSON.stringify({ pid: process.ppid, sessionId: 'sid-reused', procStart: 'Thu Jan  1 00:00:00 1970' }));
    expect(discoverActiveSessions(root, NOW)).toEqual([]);
  });

  it('discovery falls back to the mtime window when there is no sessions dir', () => {
    const r = discoverActiveSessions(build(), NOW);
    expect(r.map((s) => s.sessionId)).toEqual([S1]);
    expect(r[0].name).toBeUndefined();
    // a sessions dir that exists, even empty or unreadable, is the registry: no running sessions
    mkdirSync(join(root, 'sessions'));
    writeFileSync(join(root, 'sessions', 'x.json'), 'nope');
    expect(discoverActiveSessions(root, NOW)).toEqual([]);
  });

  it('a subagent whose meta.json has no `finished` key counts as finished once its log is 10+ min old', () => {
    const dir = build();
    const log = join(subDir(dir), 'agent-a1c6ea8b5593d9948.jsonl');
    const meta = log.replace(/\.jsonl$/, '.meta.json');
    writeFileSync(meta, JSON.stringify({ agentType: 'Explore', description: 'x' }));
    utimesSync(log, new Date(), new Date());
    expect(readMeta(log).finished).toBe(false);
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(log, old, old);
    expect(readMeta(log).finished).toBe(true);
    // an explicit `finished: false` is trusted whatever the log age
    writeFileSync(meta, JSON.stringify({ agentType: 'Explore', finished: false }));
    expect(readMeta(log).finished).toBe(false);
  });

  it('readRegistry returns null when entries parse but none has the expected shape (shape change)', () => {
    root = mkdtempSync(join(tmpdir(), 'disc-'));
    const reg = join(root, 'sessions');
    mkdirSync(reg);
    // truly empty dir: an empty registry
    expect(readRegistry(root)).toEqual([]);
    // only a half-written file: skipped, still an empty registry
    writeFileSync(join(reg, '1.json'), '{"pid": 12');
    expect(readRegistry(root)).toEqual([]);
    // JSON that parses but in an unknown shape: the registry cannot be read, fall back
    writeFileSync(join(reg, '2.json'), JSON.stringify({ processId: process.pid, id: 'sid-new-shape' }));
    expect(readRegistry(root)).toBeNull();
    // one well-formed entry (even a dead or non-interactive one) makes it a readable registry again
    writeFileSync(join(reg, '3.json'), JSON.stringify({ pid: process.pid, sessionId: 'sid-bg', kind: 'background' }));
    expect(readRegistry(root)).toEqual([]);
  });

  it('discovery uses the mtime window when the registry has only unknown-shape entries', () => {
    const r = build();
    mkdirSync(join(r, 'sessions'));
    writeFileSync(join(r, 'sessions', 'x.json'), JSON.stringify({ processId: 1, id: 'z' }));
    expect(discoverActiveSessions(r, NOW).map((s) => s.sessionId)).toEqual([S1]);
  });

  it('startTimesMatch compares parsed start times within 2 s and fails open', () => {
    expect(startTimesMatch('Fri Nov 13 06:40:01 2026', 'Fri Nov 13 06:40:01 2026')).toBe(true);
    expect(startTimesMatch('Mon Nov  3 06:40:01 2026   ', 'Mon Nov 3 06:40:02 2026')).toBe(true);
    expect(startTimesMatch('Fri Nov 13 06:40:01 2026', 'Fri Nov 13 07:40:01 2026')).toBe(false);
    expect(startTimesMatch('Fri Nov 13 06:40:01 2026', 'Fri Nov 13 06:40:05 2026')).toBe(false);
    expect(startTimesMatch('Fri Nov 13 06:40:01 2026', 'garbage')).toBe(true);
    expect(startTimesMatch('', 'Fri Nov 13 06:40:01 2026')).toBe(true);
    expect(startTimesMatch(undefined, 'Fri Nov 13 06:40:01 2026')).toBe(true);
  });

  it('subagentLogPath derives from the transcript path', () => {
    expect(subagentLogPath('/c', '/c/projects/p/abc.jsonl', 'zz')).toBe('/c/projects/p/abc/subagents/agent-zz.jsonl');
  });
});
