import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrCreateConfig } from '../src/shared/config.js';

export const SCENARIOS = ['single-subagent', 'parallel-subagents', 'nested-subagent', 'background-agent', 'named-agent', 'clear-resume'];
const LABELS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
/** Fixed cadence: recordings carry no per-event timestamps. */
const EVENT_GAP_MS = 600;
const WORK_MS = 2500;

const fixturesDir = join(fileURLToPath(new URL('..', import.meta.url)), 'tests', 'fixtures', 'hooks');
const OLD_CWD = '/scratch/ao';
const OLD_DIR = '-scratch-ao';

export type DemoOptions = { port: number; token: string; sessions?: number; speed?: number; signal?: AbortSignal };

function loadScenario(name: string): string[] {
  return readFileSync(join(fixturesDir, `${name}.jsonl`), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Rewrite one recording for a fresh fake session: new session/agent ids (also inside tool_response.agentId and
 * the transcript paths) and a distinct cwd. Replaces ids as text so every nested occurrence follows. */
export function rewriteScenario(lines: string[], label: string): Array<Record<string, unknown>> {
  const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const sessionIds = new Set(events.map((e) => e.session_id).filter((x): x is string => typeof x === 'string'));
  const agentIds = new Set(events.map((e) => e.agent_id).filter((x): x is string => typeof x === 'string'));
  const map = new Map<string, string>();
  for (const s of sessionIds) map.set(s, randomUUID());
  for (const a of agentIds) map.set(a, 'a' + randomBytes(8).toString('hex'));
  return lines.map((l) => {
    let out = l.replaceAll(OLD_CWD, `/demo/project-${label}`).replaceAll(OLD_DIR, `-demo-project-${label}`);
    for (const [from, to] of map) out = out.replaceAll(from, to);
    return JSON.parse(out) as Record<string, unknown>;
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function post(opts: DemoOptions, event: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${opts.port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Office-Token': opts.token },
      body: JSON.stringify(event),
      signal: opts.signal,
    });
  } catch {
    // server briefly unavailable or aborted: skip the event
  }
}

/** Replays the recorded hook scenarios as fake sessions over HTTP until `signal` aborts. */
export async function runDemo(opts: DemoOptions): Promise<void> {
  const n = Math.max(1, opts.sessions ?? 3);
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const signal = opts.signal;

  const runSession = async (idx: number): Promise<void> => {
    await sleep((idx * 1500) / speed, signal); // stagger so rooms don't move in lockstep
    for (let round = 0; !signal?.aborted; round++) {
      const label = idx < LABELS.length ? LABELS[idx]! : String(idx + 1);
      const events = rewriteScenario(loadScenario(SCENARIOS[(idx + round) % SCENARIOS.length]!), label);
      for (const e of events) {
        if (signal?.aborted) return;
        await post(opts, e);
        await sleep((e.hook_event_name === 'SubagentStop' ? WORK_MS : EVENT_GAP_MS) / speed, signal);
      }
      await sleep((EVENT_GAP_MS * 2) / speed, signal);
    }
  };
  await Promise.all(Array.from({ length: n }, (_, i) => runSession(i)));
}

/** Port and token for a demo run: `--port`/`--token` win, else the config in AGENT_OFFICE_DIR (or ~/.agent-office), like the app. */
export function resolveDemoConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): { port: number; token: string } {
  const cfg = loadOrCreateConfig(env.AGENT_OFFICE_DIR || join(homedir(), '.agent-office'));
  return { port: Number(flag(argv, 'port') ?? cfg.port), token: flag(argv, 'token') ?? cfg.token };
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const { port, token } = resolveDemoConfig(argv);
  const sessions = Number(flag(argv, 'sessions') ?? 3);
  const speed = Number(flag(argv, 'speed') ?? 1);
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  console.log(`demo: ${sessions} sessions at speed ${speed} -> 127.0.0.1:${port} (Ctrl-C to stop)`);
  await runDemo({ port, token, sessions, speed, signal: ac.signal });
}
