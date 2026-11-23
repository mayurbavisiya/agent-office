import { describe, it, expect, afterEach } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogWatcher } from '../src/core/logWatcher.js';
import type { LogDelta } from '../src/core/logParser.js';

const line = (id: string, input = 1) =>
  JSON.stringify({ type: 'assistant', message: { id, model: 'claude-x', usage: { input_tokens: input, output_tokens: 1 }, content: [] } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 2000) {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await sleep(10);
}

let dir = '';
let w: LogWatcher | undefined;
afterEach(() => {
  w?.close();
  w = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'lw-'));
  w = new LogWatcher(20);
  const got: { s: string; a: string | null; d: LogDelta }[] = [];
  w.on('delta', (s: string, a: string | null, d: LogDelta) => got.push({ s, a, d }));
  return { file: join(dir, 'x.jsonl'), got };
}

describe('LogWatcher', () => {
  it('emits deltas for lines appended after watch starts', async () => {
    const { file, got } = setup();
    writeFileSync(file, line('old') + '\n');
    w!.watch('s1', 'ag', file);
    await sleep(60);
    expect(got).toHaveLength(0);
    appendFileSync(file, line('m1') + '\n' + line('m2') + '\n');
    await until(() => got.length >= 2);
    expect(got.map((g) => g.d.messageId)).toEqual(['m1', 'm2']);
    expect(got[0]).toMatchObject({ s: 's1', a: 'ag' });
  });

  it('buffers a partial last line until its newline arrives', async () => {
    const { file, got } = setup();
    writeFileSync(file, '');
    w!.watch('s1', null, file);
    const l = line('p1');
    appendFileSync(file, l.slice(0, 20));
    await sleep(80);
    expect(got).toHaveLength(0);
    appendFileSync(file, l.slice(20) + '\n');
    await until(() => got.length >= 1);
    expect(got).toHaveLength(1);
    expect(got[0].d.messageId).toBe('p1');
  });

  it('skips a 5 MB garbage line without crashing', async () => {
    const { file, got } = setup();
    writeFileSync(file, '');
    w!.watch('s1', null, file);
    appendFileSync(file, 'x'.repeat(5 * 1024 * 1024) + '\n' + line('after') + '\n');
    await until(() => got.length >= 1, 4000);
    expect(got.map((g) => g.d.messageId)).toEqual(['after']);
  });

  it('handles file truncation/rotation by restarting from 0', async () => {
    const { file, got } = setup();
    writeFileSync(file, line('a', 1) + '\n' + line('b', 1) + '\n');
    w!.watch('s1', null, file);
    await sleep(60);
    writeFileSync(file, line('c', 1) + '\n');
    await until(() => got.length >= 1);
    expect(got.map((g) => g.d.messageId)).toEqual(['c']);
  });

  it('picks up a file that does not exist yet, and never throws on missing files', async () => {
    const { file, got } = setup();
    w!.watch('s1', null, file);
    await sleep(60);
    writeFileSync(file, line('late') + '\n');
    await until(() => got.length >= 1);
    expect(got.map((g) => g.d.messageId)).toEqual(['late']);
  });

  it('unwatch stops emitting', async () => {
    const { file, got } = setup();
    writeFileSync(file, '');
    w!.watch('s1', null, file);
    w!.unwatch(file);
    appendFileSync(file, line('z') + '\n');
    await sleep(80);
    expect(got).toHaveLength(0);
  });

  it('close() stops all polling: nothing emits afterwards and no timers remain', async () => {
    const { file, got } = setup();
    writeFileSync(file, '');
    w!.watch('s1', null, file);
    w!.close();
    appendFileSync(file, line('z') + '\n');
    await sleep(80);
    expect(got).toHaveLength(0);
    expect((w as unknown as { timer?: unknown }).timer).toBeUndefined();
  });

  it('fromStart emits existing lines once, then new appends', async () => {
    const { file, got } = setup();
    writeFileSync(file, line('e1') + '\n' + line('e2') + '\n');
    w!.watch('s1', null, file, { fromStart: true });
    await until(() => got.length >= 2);
    await sleep(60);
    appendFileSync(file, line('e3') + '\n');
    await until(() => got.length >= 3);
    expect(got.map((g) => g.d.messageId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('a line appended immediately after watch() is not lost (default EOF baseline is synchronous)', async () => {
    const { file, got } = setup();
    writeFileSync(file, line('old') + '\n');
    w!.watch('s1', null, file);
    appendFileSync(file, line('new') + '\n');
    await until(() => got.length >= 1);
    expect(got.map((g) => g.d.messageId)).toEqual(['new']);
  });

  it('keeps multi-byte characters intact when a line is written in two appends split mid-character', async () => {
    const { file, got } = setup();
    writeFileSync(file, '');
    w!.watch('s1', null, file);
    const l = JSON.stringify({
      type: 'assistant',
      message: { id: 'u1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'ファイル/é.ts' } }] },
    }) + '\n';
    const bytes = Buffer.from(l, 'utf8');
    const cut = bytes.indexOf(Buffer.from('é', 'utf8')) + 1; // between the two bytes of é
    appendFileSync(file, bytes.subarray(0, cut));
    await sleep(80);
    appendFileSync(file, bytes.subarray(cut));
    await until(() => got.length >= 1);
    expect(got[0].d.toolUses[0].input.file_path).toBe('ファイル/é.ts');
  });
});
