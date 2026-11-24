// Usage statistics across every Claude Code session: tokens and API-equivalent cost per local day
// and model, read from Claude Code's own logs (~/.claude/projects/**/*.jsonl). Pure helpers first,
// then UsageLedger, which does the file I/O. Claude Code deletes logs after 30 days by default, so
// daily totals are also saved to ~/.agent-office/usage.json and merged back in on start.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { requestCost, type RequestUsage } from './pricing.js';

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD at API prices, for the requests whose model has a price */
  cost: number;
  /** tokens of requests whose model has no price (counted in the token totals, not in cost) */
  unpricedTokens: number;
  requests: number;
};
/** model id -> totals, for one day */
export type DayUsage = Record<string, UsageTotals>;
/** "YYYY-MM-DD" (local time) -> that day's usage */
export type UsageDays = Record<string, DayUsage>;

export type UsageRecord = { key?: string; day: string; model: string; u: RequestUsage };

export type UsageSummary = {
  from: string;
  to: string;
  total: UsageTotals;
  models: Record<string, UsageTotals>;
  /** one row per day that has usage, oldest first */
  days: Array<{ day: string; total: UsageTotals; models: Record<string, UsageTotals> }>;
};

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of a timestamp, "YYYY-MM-DD". */
export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const emptyTotals = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpricedTokens: 0, requests: 0 });
export const totalTokens = (t: UsageTotals): number => t.input + t.output + t.cacheRead + t.cacheWrite;

/**
 * One log line to a usage record, or null. Only assistant lines with a usage block count. `key`
 * (message id + request id) dedupes the copies Claude Code writes of one API response, within a
 * file and across files (a resumed session repeats earlier lines); see takeRecord. Cache writes without the 5m/1h
 * split (older logs) count as 5m.
 */
export function parseUsageLine(line: string, dayOf: (t: number) => string = localDay): UsageRecord | null {
  if (!line.includes('"usage"')) return null;
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(o) || o.type !== 'assistant' || !isObj(o.message) || !isObj(o.message.usage)) return null;
  const msg = o.message;
  const u = msg.usage as Record<string, unknown>;
  const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
  if (model === '<synthetic>') return null;
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(t)) return null;
  const write = num(u.cache_creation_input_tokens);
  const cc = isObj(u.cache_creation) ? u.cache_creation : {};
  const write1h = Math.min(write, num(cc.ephemeral_1h_input_tokens));
  const rec: UsageRecord = {
    day: dayOf(t),
    model,
    u: { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), write5m: write - write1h, write1h },
  };
  if (typeof msg.id === 'string' && msg.id) rec.key = `${msg.id}:${typeof o.requestId === 'string' ? o.requestId : ''}`;
  return rec;
}

/** Adds one record to `days` in place; `sign` -1 takes it back out. */
export function addRecord(days: UsageDays, r: UsageRecord, sign: 1 | -1 = 1): void {
  const day = (days[r.day] ??= {});
  const t = (day[r.model] ??= emptyTotals());
  const { input, output, cacheRead, write5m, write1h } = r.u;
  t.input += sign * input;
  t.output += sign * output;
  t.cacheRead += sign * cacheRead;
  t.cacheWrite += sign * (write5m + write1h);
  t.requests += sign;
  const cost = requestCost(r.model, r.u);
  if (cost === null) t.unpricedTokens += sign * (input + output + cacheRead + write5m + write1h);
  else t.cost += sign * cost;
}

const recTokens = (r: UsageRecord) => r.u.input + r.u.output + r.u.cacheRead + r.u.write5m + r.u.write1h;

/**
 * Counts `r` once per key. Claude Code sometimes logs one response twice: a partial line (a few
 * output tokens) and then the final one; the larger replaces the smaller. Returns whether `days` changed.
 */
export function takeRecord(days: UsageDays, seen: Map<string, UsageRecord>, r: UsageRecord): boolean {
  if (!r.key) {
    addRecord(days, r);
    return true;
  }
  const prev = seen.get(r.key);
  if (prev && recTokens(r) <= recTokens(prev)) return false;
  if (prev) addRecord(days, prev, -1);
  addRecord(days, r);
  seen.set(r.key, r);
  return true;
}

/**
 * Saved history merged with a fresh scan of the logs: per day and model, the larger of the two.
 * Logs only ever lose lines (Claude Code deletes old ones), so the larger count is the complete one.
 */
export function mergeDays(saved: UsageDays, scanned: UsageDays): UsageDays {
  const out: UsageDays = {};
  for (const src of [saved, scanned]) {
    for (const [day, models] of Object.entries(src)) {
      for (const [model, t] of Object.entries(models)) {
        const cur = out[day]?.[model];
        if (!cur || totalTokens(t) > totalTokens(cur)) (out[day] ??= {})[model] = { ...t };
      }
    }
  }
  return out;
}

function addInto(a: UsageTotals, b: UsageTotals): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.cost += b.cost;
  a.unpricedTokens += b.unpricedTokens;
  a.requests += b.requests;
}

/** Totals for the days from `from` to `to`, both included ("YYYY-MM-DD"). */
export function summarize(days: UsageDays, from: string, to: string): UsageSummary {
  const total = emptyTotals();
  const models: Record<string, UsageTotals> = {};
  const rows: UsageSummary['days'] = [];
  for (const day of Object.keys(days).sort()) {
    if (day < from || day > to) continue;
    const dt = emptyTotals();
    const dm: Record<string, UsageTotals> = {};
    for (const [model, t] of Object.entries(days[day]!)) {
      addInto(dt, t);
      addInto((models[model] ??= emptyTotals()), t);
      dm[model] = { ...t };
    }
    addInto(total, dt);
    rows.push({ day, total: dt, models: dm });
  }
  return { from, to, total, models, days: rows };
}

/** A saved usage.json back to days, dropping anything malformed. */
export function parseSaved(text: string): UsageDays {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObj(v) || !isObj(v.days)) return {};
    const out: UsageDays = {};
    for (const [day, models] of Object.entries(v.days)) {
      if (!DAY_RE.test(day) || !isObj(models)) continue;
      for (const [model, t] of Object.entries(models)) {
        if (!isObj(t)) continue;
        (out[day] ??= {})[model] = {
          input: num(t.input), output: num(t.output), cacheRead: num(t.cacheRead), cacheWrite: num(t.cacheWrite),
          cost: num(t.cost), unpricedTokens: num(t.unpricedTokens), requests: num(t.requests),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

const CHUNK = 4 * 1024 * 1024;

/** Every .jsonl under `dir` (projects/<slug>/<session>.jsonl, its subagents/ and subagents/workflows/<run>/). */
function listLogs(dir: string, depth = 8): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const p = join(dir, n);
    if (n.endsWith('.jsonl')) out.push(p);
    else if (depth > 0 && !n.includes('.')) out.push(...listLogs(p, depth - 1));
  }
  return out;
}

/**
 * Reads all logs once in the background, then only what was appended, every `pollMs`. `days()` is
 * the saved history merged with the scan. Tokens never leave this process except through the
 * token-protected /usage endpoint.
 */
export class UsageLedger {
  private scanned: UsageDays = {};
  private saved: UsageDays;
  private readonly offsets = new Map<string, number>();
  private readonly seen = new Map<string, UsageRecord>();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private dirty = false;
  private closed = false;
  scanning = true;

  constructor(
    private readonly projectsDir: string,
    private readonly savePath: string,
    private readonly pollMs = 30_000,
  ) {
    let text = '';
    try {
      text = readFileSync(savePath, 'utf8');
    } catch {
      /* first run */
    }
    this.saved = parseSaved(text);
  }

  /** Starts the first full read; resolves when it is done. */
  start(): Promise<void> {
    const first = this.poll().finally(() => {
      this.scanning = false;
    });
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
    return first;
  }

  days(): UsageDays {
    return mergeDays(this.saved, this.scanned);
  }

  summary(from: string, to: string): UsageSummary {
    return summarize(this.days(), from, to);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.dirty) this.save();
  }

  /** One pass over the logs; passes never overlap. */
  poll(): Promise<void> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async pass(): Promise<void> {
    for (const path of listLogs(this.projectsDir)) {
      if (this.closed) return;
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        continue;
      }
      const from = this.offsets.get(path) ?? 0;
      if (size < from) this.offsets.set(path, 0); // rewritten: read again (the dedupe keys keep counts right)
      if (size > (this.offsets.get(path) ?? 0)) await this.readFrom(path, this.offsets.get(path) ?? 0, size);
    }
    if (this.dirty) this.save();
  }

  /** Reads complete lines from `start` up to `end`; a partial last line waits for the next pass. */
  private async readFrom(path: string, start: number, end: number): Promise<void> {
    let fh;
    try {
      fh = await open(path, 'r');
    } catch {
      return;
    }
    try {
      let pos = start;
      let carry = '';
      while (pos < end) {
        const buf = Buffer.alloc(Math.min(CHUNK, end - pos));
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        const text = carry + buf.toString('utf8', 0, bytesRead);
        const lines = text.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) this.take(line);
        await new Promise((r) => setImmediate(r)); // keep the event server responsive
      }
      // carry is an unfinished line: re-read it next time
      this.offsets.set(path, pos - Buffer.byteLength(carry, 'utf8'));
    } finally {
      await fh.close();
    }
  }

  private take(line: string): void {
    const r = parseUsageLine(line);
    if (!r) return;
    if (takeRecord(this.scanned, this.seen, r)) this.dirty = true;
  }

  private save(): void {
    this.dirty = false;
    try {
      const days = this.days();
      this.saved = days;
      mkdirSync(join(this.savePath, '..'), { recursive: true, mode: 0o700 });
      const tmp = `${this.savePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, days }), { mode: 0o600 });
      renameSync(tmp, this.savePath);
    } catch {
      /* best effort: the scan is still in memory */
    }
  }
}
