import type { AgentStats } from '../shared/types.js';

export type ModelInfo = {
  /** USD per million tokens */
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  /** 1-hour cache write rate (Claude Code requests 1h caching, see "promptCacheRequested":"1h" in logs) */
  cacheWritePerM: number;
  /** tokens */
  contextSize: number;
};

/**
 * Every per-model value lives here. Source: Anthropic official docs, fetched 2026-11-23:
 *  - prices: https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing" table)
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
  'claude-fable-5-2': { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2, cacheWritePerM: 16, contextSize: 1_000_000 },
  'claude-opus-5-5': { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 8, contextSize: 1_000_000 },
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1, cacheWritePerM: 4, contextSize: 1_000_000 },
  'claude-haiku-5-5': { inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01, cacheWritePerM: 0.2, contextSize: 1_000_000 },
};

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
