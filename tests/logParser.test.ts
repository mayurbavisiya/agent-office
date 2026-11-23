import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogLine, emptyStats, applyDelta, type LogDelta } from '../src/core/logParser.js';

const FIX = join(__dirname, 'fixtures/logs/single-subagent');
const MAIN = join(FIX, 'f9e58de5-4a17-4ce3-b430-e3d054dfb702.jsonl');
const SUB = join(FIX, 'f9e58de5-4a17-4ce3-b430-e3d054dfb702/subagents/agent-a1c6ea8b5593d9948.jsonl');
const lines = (f: string) => readFileSync(f, 'utf8').split('\n');
const deltas = (f: string) => lines(f).map(parseLogLine).filter((d): d is LogDelta => d !== null);

const delta = (o: Partial<LogDelta> = {}): LogDelta => ({ toolUses: [], ...o });
const usage = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });

describe('parseLogLine', () => {
  it('parses assistant usage: input/output/cache_read_input_tokens/cache_creation_input_tokens and model', () => {
    const d = deltas(MAIN)[0];
    expect(d.model).toBe('claude-haiku-5-5');
    expect(d.usage).toEqual({ input: 2, output: 380, cacheRead: 13404, cacheWrite: 13017 });
    expect(d.messageId).toBe('msg_011ChLEqjniqJmF1qUupoztf');
    expect(d.timestamp).toBe(Date.parse('2026-11-23T17:17:09.212Z'));
  });

  it('extracts tool_use blocks as toolUses with name and input', () => {
    const withTool = deltas(MAIN).find((d) => d.toolUses.length > 0)!;
    expect(withTool.toolUses[0].name).toBe('Agent');
    expect(withTool.toolUses[0].input).toMatchObject({ description: 'List files in ao folder', subagent_type: 'Explore' });
  });

  it('returns null for garbage, blank, and non-assistant lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
    expect(parseLogLine('{not json')).toBeNull();
    expect(parseLogLine('null')).toBeNull();
    expect(parseLogLine('[1,2]')).toBeNull();
    expect(parseLogLine('{"type":"user","message":{"role":"user","content":"hi"}}')).toBeNull();
    expect(parseLogLine('{"type":"assistant"}')).toBeNull();
    expect(parseLogLine('{"type":"assistant","message":{"content":"str"}}')).toBeNull();
    expect(parseLogLine('{"type":"assistant","message":{"usage":{"input_tokens":"x"},"content":[null,5,{"type":"tool_use"}]}}')).toBeNull();
  });

  it('populates gitBranch and cwd from top-level fields', () => {
    const d = deltas(MAIN)[0];
    expect(d.cwd).toBe('/scratch/ao');
    expect(typeof d.gitBranch).toBe('string');
    expect(parseLogLine('{"type":"assistant","cwd":"/x","gitBranch":"main","message":{"model":"m"}}')).toMatchObject({ cwd: '/x', gitBranch: 'main' });
  });

  it('every fixture line parses without throwing', () => {
    for (const f of [MAIN, SUB]) for (const l of lines(f)) expect(() => parseLogLine(l)).not.toThrow();
  });
});

describe('applyDelta', () => {
  it('sums tokens, counts tools, adds file_path/path/pattern inputs to files (deduped), keeps last 20 recent entries like "Grep authMiddleware"', () => {
    let s = emptyStats(1000);
    s = applyDelta(s, delta({ model: 'm', usage: usage(10, 5, 100, 20), messageId: 'a', timestamp: 2000 }));
    s = applyDelta(s, delta({ usage: usage(1, 2, 3, 4), messageId: 'b' }));
    expect(s).toMatchObject({ model: 'm', inputTokens: 11, outputTokens: 7, cacheRead: 103, cacheWrite: 24, lastActivity: 2000 });

    s = applyDelta(s, delta({ toolUses: [
      { name: 'Grep', input: { pattern: 'authMiddleware', path: 'src' } },
      { name: 'Read', input: { file_path: 'src/a.ts' } },
      { name: 'Read', input: { file_path: 'src/a.ts' } },
      { name: 'Bash', input: { command: 'ls' } },
    ] }));
    expect(s.tools).toEqual({ Grep: 1, Read: 2, Bash: 1 });
    expect(s.files).toEqual(['authMiddleware', 'src', 'src/a.ts']);
    expect(s.recent).toContain('Grep authMiddleware');
    expect(s.recent).toContain('Bash');

    for (let i = 0; i < 30; i++) s = applyDelta(s, delta({ toolUses: [{ name: 'Read', input: { file_path: `f${i}` } }] }));
    expect(s.recent).toHaveLength(20);
    expect(s.recent[19]).toBe('Read f29');
    expect(s.recent[0]).toBe('Read f10');
  });

  it('does not mutate the input stats', () => {
    const s = emptyStats(1);
    applyDelta(s, delta({ usage: usage(5), messageId: 'x', toolUses: [{ name: 'Read', input: { file_path: 'a' } }] }));
    expect(s.inputTokens).toBe(0);
    expect(s.tools).toEqual({});
    expect(s.files).toEqual([]);
  });

  it('contextFill = (input+cacheRead+cacheWrite of latest usage) / contextSize(model)', () => {
    let s = applyDelta(emptyStats(0), delta({ model: 'claude-haiku-5-5', usage: usage(2, 380, 13404, 13017), messageId: 'a' }));
    expect(s.contextFill).toBeCloseTo((2 + 13404 + 13017) / 1_000_000, 10);
    s = applyDelta(s, delta({ usage: usage(1, 1, 500_000, 0), messageId: 'b' }));
    expect(s.contextFill).toBeCloseTo(500_001 / 1_000_000, 10);
    const unknown = applyDelta(emptyStats(0), delta({ model: 'mystery', usage: usage(5), messageId: 'c' }));
    expect(unknown.contextFill).toBeUndefined();
  });

  it('dedupes usage across lines sharing message.id', () => {
    const ds = deltas(MAIN);
    const ids = ds.filter((d) => d.usage).map((d) => d.messageId);
    expect(ids.length).toBeGreaterThan(new Set(ids).size); // fixture really has duplicate lines
    const uniq = new Map<string, NonNullable<LogDelta['usage']>>();
    for (const d of ds) if (d.usage && d.messageId && !uniq.has(d.messageId)) uniq.set(d.messageId, d.usage);
    const expectedOut = [...uniq.values()].reduce((a, u) => a + u.output, 0);
    const naiveOut = ds.reduce((a, d) => a + (d.usage?.output ?? 0), 0);
    expect(naiveOut).toBeGreaterThan(expectedOut);

    const s = ds.reduce(applyDelta, emptyStats(0));
    expect(s.outputTokens).toBe(expectedOut);
    // tool uses on every line still counted (distinct blocks)
    const toolCount = ds.reduce((a, d) => a + d.toolUses.length, 0);
    expect(Object.values(s.tools).reduce((a, b) => a + b, 0)).toBe(toolCount);
  });

  it('keeps the seen-id set bounded and counts usage without messageId every time', () => {
    let s = emptyStats(0);
    for (let i = 0; i < 500; i++) s = applyDelta(s, delta({ usage: usage(1), messageId: `m${i}` }));
    expect(s.inputTokens).toBe(500);
    expect(s.seenMessageIds!.length).toBeLessThanOrEqual(50);
    s = applyDelta(s, delta({ usage: usage(1) }));
    s = applyDelta(s, delta({ usage: usage(1) }));
    expect(s.inputTokens).toBe(502);
  });
});
