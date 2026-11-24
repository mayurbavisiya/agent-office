import type { AgentStats } from '../shared/types.js';

export type ModelInfo = {
  /** USD per million tokens */
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  /** 1-hour cache write rate (Claude Code requests 1h caching, see "promptCacheRequested":"1h" in logs) */
  cacheWritePerM: number;
  /** 5-minute cache write rate (1.25x input); logs split cache writes into 5m and 1h */
  cacheWrite5mPerM: number;
  /** prices for prompts over `longOver` tokens (input + cache read + cache write), when the model is tiered */
  long?: { over: number; inputPerM: number; outputPerM: number; cacheReadPerM: number; cacheWritePerM: number; cacheWrite5mPerM: number };
  /** tokens */
  contextSize: number;
};

/**
 * Every per-model value lives here. Source: Anthropic official docs, fetched 2026-11-23:
 *  - prices: https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing" table; rechecked 2026-11-24,
 *    when claude-fable-5-1, claude-sonnet-4-6, the 5m cache-write rates and Haiku's long-prompt tier were added)
 *  - API ids + context window: https://platform.claude.com/docs/en/models/overview ("Latest models")
 * Only models whose API id AND prices were confirmed there are listed; others yield null/undefined.
 *
 * Caveats:
 *  - claude-haiku-5-5 is tiered by per-request prompt length; the values below are the "up to 100,000
 *    tokens" tier ($0.50/$2.50 input/output over 100k). Stats are cumulative so the tier is unknowable:
 *    the estimate is a lower bound for long-context requests.
 *  - Cache write uses the 1h rate (2x input); 5m would be 1.25x.
 */
export const MODELS: Record<string, ModelInfo> = {
  'claude-fable-5-2': { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2, cacheWritePerM: 16, cacheWrite5mPerM: 10, contextSize: 1_000_000 },
  'claude-fable-5-1': { inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25, cacheWritePerM: 20, cacheWrite5mPerM: 12.5, contextSize: 1_000_000 },
  'claude-opus-5-5': { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 8, cacheWrite5mPerM: 5, contextSize: 1_000_000 },
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1, cacheWritePerM: 4, cacheWrite5mPerM: 2.5, contextSize: 1_000_000 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 6, cacheWrite5mPerM: 3.75, contextSize: 1_000_000 },
  'claude-haiku-5-5': {
    inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01, cacheWritePerM: 0.2, cacheWrite5mPerM: 0.125, contextSize: 1_000_000,
    long: { over: 100_000, inputPerM: 0.5, outputPerM: 2.5, cacheReadPerM: 0.05, cacheWritePerM: 1, cacheWrite5mPerM: 0.625 },
  },
};

/** One API request's usage, with cache writes split by duration (as Claude Code logs them). */
export type RequestUsage = { input: number; output: number; cacheRead: number; write5m: number; write1h: number };

/**
 * USD for one request at API prices, or null for a model not in the table. Priced per request, so a
 * tiered model (Haiku 5.5 over 100k prompt tokens) gets the right tier.
 */
export function requestCost(model: string | undefined, u: RequestUsage): number | null {
  const m = lookup(model);
  if (!m) return null;
  const prompt = u.input + u.cacheRead + u.write5m + u.write1h;
  const p = m.long && prompt > m.long.over ? m.long : m;
  return (u.input * p.inputPerM + u.output * p.outputPerM + u.cacheRead * p.cacheReadPerM + u.write5m * p.cacheWrite5mPerM + u.write1h * p.cacheWritePerM) / 1_000_000;
}

const lookup = (model?: string): ModelInfo | undefined =>
  model !== undefined && Object.prototype.hasOwnProperty.call(MODELS, model) ? MODELS[model] : undefined;

export function contextSize(model?: string): number | undefined {
  return lookup(model)?.contextSize;
}

export function estimateCost(stats: AgentStats): number | null {
  const m = lookup(stats.model);
  if (!m) return null;
  return (
    (stats.inputTokens * m.inputPerM +
      stats.outputTokens * m.outputPerM +
      stats.cacheRead * m.cacheReadPerM +
      stats.cacheWrite * m.cacheWritePerM) /
    1_000_000
  );
}
