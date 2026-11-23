import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverActiveSessions, subagentLogPath } from '../src/core/discovery.js';
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
      { agentId: 'a1c6ea8b5593d9948', path: join(root, 'projects', 'proj-a', S1, 'subagents', 'agent-a1c6ea8b5593d9948.jsonl') },
    ]);
  });

  it('honours a claudeDir passed from CLAUDE_CONFIG_DIR', () => {
    const dir = build();
    const r = discoverActiveSessions(claudeDir({ CLAUDE_CONFIG_DIR: dir }), NOW);
    expect(r.map((s) => s.sessionId)).toEqual([S1]);
  });

  it('returns [] when the projects dir is missing', () => {
    expect(discoverActiveSessions(join(tmpdir(), 'nope-' + NOW), NOW)).toEqual([]);
  });

  it('subagentLogPath derives from the transcript path', () => {
    expect(subagentLogPath('/c', '/c/projects/p/abc.jsonl', 'zz')).toBe('/c/projects/p/abc/subagents/agent-zz.jsonl');
  });
});
