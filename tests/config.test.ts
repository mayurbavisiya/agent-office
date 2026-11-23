import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateConfig, claudeDir } from '../src/shared/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ao-config-'));

describe('config', () => {
  it('creates config with port 47821 and 64-hex token, mode 0600', () => {
    const dir = join(tmp(), 'nested');
    const cfg = loadOrCreateConfig(dir);
    expect(cfg.port).toBe(47821);
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    const file = join(dir, 'config.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(cfg);
  });

  it('returns existing config unchanged on second call', () => {
    const dir = tmp();
    const a = loadOrCreateConfig(dir);
    const b = loadOrCreateConfig(dir);
    expect(b).toEqual(a);
  });

  it('claudeDir uses CLAUDE_CONFIG_DIR when set, else ~/.claude', () => {
    expect(claudeDir({ CLAUDE_CONFIG_DIR: '/x/y' })).toBe('/x/y');
    expect(claudeDir({})).toBe(join(homedir(), '.claude'));
  });
});
