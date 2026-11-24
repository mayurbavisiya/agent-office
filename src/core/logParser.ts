import type { AgentStats } from '../shared/types.js';
import { contextSize } from './pricing.js';

export type LogDelta = {
  timestamp?: number;
  model?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** message.id: one API message is logged as several lines with identical usage; usage counts once per id */
  messageId?: string;
  gitBranch?: string;
  cwd?: string;
  toolUses: { name: string; input: Record<string, unknown> }[];
};

const MAX_RECENT = 20;
/** files touched: the most recently touched unique entries, newest last */
const MAX_FILES = 200;
/** Lines of one message are adjacent, so a small window of recent ids is enough. */
const MAX_SEEN = 50;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function parseLogLine(line: string): LogDelta | null {
  try {
    if (!line || !line.trim()) return null;
    const obj: unknown = JSON.parse(line);
    if (!isObj(obj) || obj.type !== 'assistant' || !isObj(obj.message)) return null;
    const msg = obj.message;
    const d: LogDelta = { toolUses: [] };
    let relevant = false;

    if (typeof obj.timestamp === 'string') {
      const t = Date.parse(obj.timestamp);
      if (Number.isFinite(t)) d.timestamp = t;
    }
    if (typeof obj.gitBranch === 'string' && obj.gitBranch) d.gitBranch = obj.gitBranch;
    if (typeof obj.cwd === 'string' && obj.cwd) d.cwd = obj.cwd;
    if (typeof msg.model === 'string' && msg.model) {
      d.model = msg.model;
      relevant = true;
    }
    if (typeof msg.id === 'string' && msg.id) d.messageId = msg.id;
    if (isObj(msg.usage)) {
      const u = msg.usage;
      if (['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some((k) => typeof u[k] === 'number')) {
        d.usage = {
          input: num(u.input_tokens),
          output: num(u.output_tokens),
          cacheRead: num(u.cache_read_input_tokens),
          cacheWrite: num(u.cache_creation_input_tokens),
        };
        relevant = true;
      }
    }
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (isObj(b) && b.type === 'tool_use' && typeof b.name === 'string') {
          d.toolUses.push({ name: b.name, input: isObj(b.input) ? b.input : {} });
          relevant = true;
        }
      }
    }
    return relevant ? d : null;
  } catch {
    return null;
  }
}

export function emptyStats(now: number): AgentStats {
  return { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, tools: {}, files: [], recent: [], lastActivity: now };
}

/**
 * Pure: returns a new stats object. Dedupe state lives IN the stats (`seenMessageIds`, newest last,
 * capped at MAX_SEEN) so it survives copies/serialization. Usage without a messageId is always counted.
 */
export function applyDelta(stats: AgentStats, d: LogDelta): AgentStats {
  const s: AgentStats = { ...stats, tools: { ...stats.tools }, files: [...stats.files], recent: [...stats.recent] };
  if (d.model) s.model = d.model;
  if (d.timestamp !== undefined) s.lastActivity = d.timestamp;

  if (d.usage) {
    const seen = stats.seenMessageIds ?? [];
    const dup = d.messageId !== undefined && seen.includes(d.messageId);
    if (!dup) {
      s.inputTokens += d.usage.input;
      s.outputTokens += d.usage.output;
      s.cacheRead += d.usage.cacheRead;
      s.cacheWrite += d.usage.cacheWrite;
      if (d.messageId !== undefined) s.seenMessageIds = [...seen, d.messageId].slice(-MAX_SEEN);
    }
    s.contextTokens = d.usage.input + d.usage.cacheRead + d.usage.cacheWrite + d.usage.output;
    const size = contextSize(s.model);
    s.contextFill = size ? (d.usage.input + d.usage.cacheRead + d.usage.cacheWrite) / size : undefined;
  }

  for (const t of d.toolUses) {
    s.tools[t.name] = (s.tools[t.name] ?? 0) + 1;
    let target: string | undefined;
    for (const k of ['pattern', 'file_path', 'path']) {
      const v = t.input[k];
      if (typeof v === 'string' && v) {
        target ??= v;
        const i = s.files.indexOf(v);
        if (i >= 0) s.files.splice(i, 1);
        s.files.push(v);
      }
    }
    s.recent.push(target ? `${t.name} ${target}` : t.name);
  }
  if (s.recent.length > MAX_RECENT) s.recent = s.recent.slice(-MAX_RECENT);
  if (s.files.length > MAX_FILES) s.files = s.files.slice(-MAX_FILES);
  return s;
}
