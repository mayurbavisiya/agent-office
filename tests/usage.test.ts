import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requestCost } from '../src/core/pricing.js';
import { mergeDays, parseSaved, parseUsageLine, summarize, takeRecord, totalTokens, UsageLedger, type UsageDays, type UsageRecord } from '../src/core/usage.js';

const line = (o: { id?: string; req?: string; model?: string; ts?: string; input?: number; output?: number; read?: number; write?: number; w1h?: number; type?: string }) =>
  JSON.stringify({
    type: o.type ?? 'assistant',
    timestamp: o.ts ?? '2026-11-23T12:00:00.000Z',
    requestId: o.req ?? 'req_1',
    message: {
      id: o.id ?? 'msg_1',
      model: o.model ?? 'claude-opus-5-5',
      usage: {
        input_tokens: o.input ?? 10,
        output_tokens: o.output ?? 100,
        cache_read_input_tokens: o.read ?? 1000,
        cache_creation_input_tokens: o.write ?? 200,
        cache_creation: { ephemeral_5m_input_tokens: (o.write ?? 200) - (o.w1h ?? 0), ephemeral_1h_input_tokens: o.w1h ?? 0 },
      },
    },
  });
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('pricing per request', () => {
  it('prices 5-minute and 1-hour cache writes at their own rates (official table, Opus 5.5)', () => {
    // $4 in, $20 out, $0.20 read, $5 5m write, $8 1h write per million
    expect(requestCost('claude-opus-5-5', { input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6 })).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 10);
  });
  it('knows Sonnet 4.6 and Fable 5.1', () => {
    expect(requestCost('claude-sonnet-4-6', { input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6 })).toBeCloseTo(3 + 15 + 0.3 + 3.75 + 6, 10);
    expect(requestCost('claude-fable-5-1', { input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6 })).toBeCloseTo(10 + 50 + 0.25 + 12.5 + 20, 10);
  });
  it('charges Haiku 5.5 its long-prompt prices only for prompts over 100k tokens', () => {
    expect(requestCost('claude-haiku-5-5', { input: 100_000, output: 0, cacheRead: 0, write5m: 0, write1h: 0 })).toBeCloseTo(0.01, 10);
    expect(requestCost('claude-haiku-5-5', { input: 100_001, output: 0, cacheRead: 0, write5m: 0, write1h: 0 })).toBeCloseTo(0.0500005, 10);
  });
  it('is null for a model without a price', () => {
    expect(requestCost('mystery-1', { input: 1, output: 1, cacheRead: 0, write5m: 0, write1h: 0 })).toBeNull();
  });
});

describe('parseUsageLine', () => {
  it('reads tokens, splits cache writes, and keys on message + request id', () => {
    const r = parseUsageLine(line({ write: 300, w1h: 100 }), utcDay)!;
    expect(r).toEqual({ key: 'msg_1:req_1', day: '2026-11-23', model: 'claude-opus-5-5', u: { input: 10, output: 100, cacheRead: 1000, write5m: 200, write1h: 100 } });
  });
  it('ignores user lines, synthetic messages, broken JSON and lines without usage', () => {
    expect(parseUsageLine(line({ type: 'user' }))).toBeNull();
    expect(parseUsageLine(line({ model: '<synthetic>' }))).toBeNull();
    expect(parseUsageLine('{"usage": oops')).toBeNull();
    expect(parseUsageLine('{"type":"assistant","message":{"content":[]}}')).toBeNull();
  });
  it('counts cache writes without the 5m/1h split as 5-minute writes', () => {
    const raw = JSON.parse(line({ write: 50 }));
    delete raw.message.usage.cache_creation;
    expect(parseUsageLine(JSON.stringify(raw), utcDay)!.u).toMatchObject({ write5m: 50, write1h: 0 });
  });
});

describe('takeRecord: one response counted once', () => {
  const rec = (output: number, key = 'k'): UsageRecord => ({ key, day: '2026-11-23', model: 'claude-opus-5-5', u: { input: 0, output, cacheRead: 0, write5m: 0, write1h: 0 } });
  it('skips an identical copy, and lets the final line replace an earlier partial one', () => {
    const days: UsageDays = {};
    const seen = new Map<string, UsageRecord>();
    expect(takeRecord(days, seen, rec(4))).toBe(true);
    expect(takeRecord(days, seen, rec(4))).toBe(false);
    expect(takeRecord(days, seen, rec(1652))).toBe(true);
    expect(takeRecord(days, seen, rec(4))).toBe(false);
    const t = days['2026-11-23']!['claude-opus-5-5']!;
    expect(t.output).toBe(1652);
    expect(t.requests).toBe(1);
    expect(t.cost).toBeCloseTo((1652 * 20) / 1e6, 10);
  });
});

describe('summaries and saved history', () => {
  const t = (output: number, cost = 0) => ({ input: 0, output, cacheRead: 0, cacheWrite: 0, cost, unpricedTokens: 0, requests: 1 });
  it('sums only the days in range, both ends included, per day and per model', () => {
    const days: UsageDays = { '2026-11-01': { a: t(1, 1) }, '2026-11-02': { a: t(2, 2), b: t(3, 3) }, '2026-11-03': { b: t(4, 4) } };
    const s = summarize(days, '2026-11-02', '2026-11-03');
    expect(s.total.output).toBe(9);
    expect(s.total.cost).toBe(9);
    expect(s.models.b!.output).toBe(7);
    expect(s.days.map((d) => d.day)).toEqual(['2026-11-02', '2026-11-03']);
    expect(summarize(days, '2026-12-01', '2026-12-31').days).toEqual([]);
  });
  it('keeps saved days the logs no longer have, and the larger count where both have a day', () => {
    const saved: UsageDays = { '2026-09-01': { a: t(5) }, '2026-11-01': { a: t(10) } };
    const scanned: UsageDays = { '2026-11-01': { a: t(7) }, '2026-11-02': { a: t(1) } };
    const m = mergeDays(saved, scanned);
    expect(Object.keys(m).sort()).toEqual(['2026-09-01', '2026-11-01', '2026-11-02']);
    expect(m['2026-11-01']!.a!.output).toBe(10);
  });
  it('drops malformed saved data', () => {
    expect(parseSaved('nope')).toEqual({});
    expect(parseSaved(JSON.stringify({ days: { 'not-a-day': {}, '2026-11-01': { a: { output: -5, cost: 'x' } } } }))).toEqual({
      '2026-11-01': { a: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpricedTokens: 0, requests: 0 } },
    });
  });
});

describe('UsageLedger', () => {
  it('reads every log (workflow agents included), picks up appended lines, and saves daily totals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ao-usage-'));
    const projects = join(root, 'projects');
    const wf = join(projects, '-x', 'sess', 'subagents', 'workflows', 'wf_1');
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(projects, '-x', 'sess.jsonl'), line({ id: 'a', output: 100 }) + '\n' + line({ id: 'a', output: 100 }) + '\n');
    writeFileSync(join(wf, 'agent-1.jsonl'), line({ id: 'b', output: 50 }) + '\n' + line({ id: 'c', output: 7 })); // last line unfinished
    const save = join(root, 'cfg', 'usage.json');
    const ledger = new UsageLedger(projects, save, 60_000);
    await ledger.start();
    const day = parseUsageLine(line({}))!.day;
    expect(ledger.summary(day, day).total.output).toBe(150);
    expect(ledger.scanning).toBe(false);

    appendFileSync(join(wf, 'agent-1.jsonl'), '\n' + line({ id: 'd', output: 3 }) + '\n');
    await ledger.poll();
    const s = ledger.summary(day, day);
    expect(s.total.output).toBe(160);
    expect(totalTokens(s.total)).toBe(160 + 4 * (10 + 1000 + 200));
    ledger.close();
    expect(parseSaved(readFileSync(save, 'utf8'))[day]!['claude-opus-5-5']!.output).toBe(160);

    // a new run whose logs are gone still has the saved days
    const again = new UsageLedger(join(root, 'nothing'), save, 60_000);
    await again.start();
    expect(again.summary(day, day).total.output).toBe(160);
    again.close();
  });
});

describe('scene helpers', async () => {
  const { rangeFor, fmtTokens, fmtUsd, modelLabel, barText } = await import('../src/scene/usageBar.js');
  it('today, week from Monday, month from the 1st, custom in order', () => {
    const wed = new Date(2026, 10, 25, 15); // Wed 25 Nov 2026
    expect(rangeFor('today', wed)).toEqual({ from: '2026-11-25', to: '2026-11-25' });
    expect(rangeFor('week', wed)).toEqual({ from: '2026-11-23', to: '2026-11-25' });
    expect(rangeFor('week', new Date(2026, 10, 29))).toEqual({ from: '2026-11-23', to: '2026-11-29' }); // Sunday
    expect(rangeFor('week', new Date(2026, 11, 1))).toEqual({ from: '2026-11-30', to: '2026-12-01' });
    expect(rangeFor('month', wed)).toEqual({ from: '2026-11-01', to: '2026-11-25' });
    expect(rangeFor('custom', wed, { from: '2026-11-20', to: '2026-11-01' })).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(rangeFor('custom', wed, { from: 'x', to: '2026-11-01' })).toEqual({ from: '2026-11-25', to: '2026-11-25' });
  });
  it('formats tokens in millions and cost in dollars', () => {
    expect([fmtTokens(950), fmtTokens(48_210), fmtTokens(2_973_735), fmtTokens(509_101_112), fmtTokens(3_350_878_678)]).toEqual(['950', '48.2k', '2.97M', '509.1M', '3.35B']);
    expect([fmtUsd(1409.344), fmtUsd(0), fmtUsd(0.001)]).toEqual(['$1,409.34', '$0.00', '<$0.01']);
    expect([modelLabel('claude-opus-5-5'), modelLabel('claude-sonnet-4-6'), modelLabel('weird')]).toEqual(['Opus 5.5', 'Sonnet 4.6', 'weird']);
  });
  it('says when logs are still being read, or when some tokens have no price', () => {
    const total = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 5, unpricedTokens: 0, requests: 1 };
    expect(barText(null).cost).toBe('—');
    expect(barText({ scanning: true, from: '', to: '', total, models: {}, days: [] }).note).toBe('reading logs…');
    expect(barText({ scanning: false, from: '', to: '', total: { ...total, unpricedTokens: 2_000_000 }, models: {}, days: [] }).note).toBe('2.00M tokens from unpriced models not in cost');
    expect(barText({ scanning: false, from: '', to: '', total, models: {}, days: [] })).toMatchObject({ cost: '~$5.00', tokens: '10', written: '2', note: '' });
  });
});
