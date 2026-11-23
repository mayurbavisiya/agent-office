import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = { port: number; token: string };

const DEFAULT_PORT = 47821;

export function loadOrCreateConfig(dir: string = join(homedir(), '.agent-office')): Config {
  const file = join(dir, 'config.json');
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
    if (typeof parsed.port === 'number' && typeof parsed.token === 'string' && parsed.token) {
      return { port: parsed.port, token: parsed.token };
    }
  }
  const cfg: Config = { port: DEFAULT_PORT, token: randomBytes(32).toString('hex') };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return cfg;
}

export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}
