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

function readValid(file: string): Config | undefined {
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config> | null;
    if (p && typeof p === 'object' && validPort(p.port) && typeof p.token === 'string' && p.token) return { port: p.port, token: p.token };
  } catch {
    // unreadable or corrupt
  }
  return undefined;
}

/**
 * Creates `<dir>/config.json` (dir 0700, file 0600) only if no file is there (`wx`). When another
 * process won the race and wrote it first, its values are used, so a tracker and the app starting at
 * once agree on one token. A file there that is not a valid config is returned as undefined.
 */
export function createConfigFile(dir: string, cfg: Config): Config | undefined {
  const file = join(dir, 'config.json');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readValid(file);
    throw err;
  }
  chmodSync(file, 0o600);
  return cfg;
}

/**
 * Reads `<dir>/config.json`, or writes a fresh one (dir 0700, file 0600). A corrupt or incomplete file is
 * regenerated with a new token, keeping its port when one can be read from it.
 */
export function loadOrCreateConfig(dir: string = join(homedir(), '.agent-office')): Config {
  const file = join(dir, 'config.json');
  let port = DEFAULT_PORT;
  if (!existsSync(file)) {
    const made = createConfigFile(dir, { port, token: randomBytes(32).toString('hex') });
    if (made) return made;
    // lost the race to a writer whose file is not (yet) valid: handled as a corrupt file below
  }
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
  const cfg: Config = { port, token: randomBytes(32).toString('hex') };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return cfg;
}

export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}
