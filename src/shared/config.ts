import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = { port: number; token: string };

const DEFAULT_PORT = 47821;

const validPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0 && p <= 65535;

/** A usable port from a config file that may not parse: the JSON value, else a `"port": N` found in the text. */
function salvagePort(text: string, parsed: unknown): number | undefined {
  const p = typeof parsed === 'object' && parsed !== null ? (parsed as { port?: unknown }).port : undefined;
  if (validPort(p)) return p;
  const m = /"port"\s*:\s*(\d{1,5})(?!\d)/.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return validPort(n) ? n : undefined;
}

/**
 * Reads `<dir>/config.json`, or writes a fresh one (dir 0700, file 0600). A corrupt or incomplete file is
 * regenerated with a new token, keeping its port when one can be read from it.
 */
export function loadOrCreateConfig(dir: string = join(homedir(), '.agent-office')): Config {
  const file = join(dir, 'config.json');
  let port = DEFAULT_PORT;
  if (existsSync(file)) {
    let text = '';
    let parsed: unknown;
    try {
      text = readFileSync(file, 'utf8');
      parsed = JSON.parse(text);
    } catch {
      // unreadable or corrupt: regenerated below
    }
    const p = typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Config>) : undefined;
    if (p && validPort(p.port) && typeof p.token === 'string' && p.token) return { port: p.port, token: p.token };
    port = salvagePort(text, parsed) ?? DEFAULT_PORT;
  }
  const cfg: Config = { port, token: randomBytes(32).toString('hex') };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return cfg;
}

export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}
