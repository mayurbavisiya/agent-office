import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateConfig, claudeDir, createConfigFile } from '../src/shared/config.js';

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

  it('two creates in sequence against an existing file keep its token', () => {
    const dir = tmp();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ port: 51999, token: 'kept-token' }), { mode: 0o600 });
    const a = loadOrCreateConfig(dir);
    const b = loadOrCreateConfig(dir);
    expect(a).toEqual({ port: 51999, token: 'kept-token' });
    expect(b).toEqual(a);
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe('kept-token');
  });

  it('a create that loses the race to another writer adopts the file already there', () => {
    const dir = tmp();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ port: 51998, token: 'first-writer' }), { mode: 0o600 });
    const got = createConfigFile(dir, { port: 47000, token: 'second-writer' });
    expect(got).toEqual({ port: 51998, token: 'first-writer' });
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe('first-writer');
  });

  it('createConfigFile writes a new file 0600 in a 0700 dir', () => {
    const dir = join(tmp(), 'fresh');
    const got = createConfigFile(dir, { port: 51997, token: 't' });
    expect(got).toEqual({ port: 51997, token: 't' });
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('returns existing config unchanged on second call', () => {
    const dir = tmp();
    const a = loadOrCreateConfig(dir);
    const b = loadOrCreateConfig(dir);
    expect(b).toEqual(a);
  });

  it('corrupt config is regenerated and keeps a valid port', () => {
    const dir = tmp();
    const file = join(dir, 'config.json');
    writeFileSync(file, '{"port": 51234, "token": "abc', { mode: 0o644 });
    const cfg = loadOrCreateConfig(dir);
    expect(cfg.port).toBe(51234);
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(cfg);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('corrupt config with no usable port falls back to the default port', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'config.json'), 'not json at all, port 99999999');
    expect(loadOrCreateConfig(dir).port).toBe(47821);
  });

  it('a valid port with a missing token keeps the port', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 40001 }));
    const cfg = loadOrCreateConfig(dir);
    expect(cfg.port).toBe(40001);
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates the config dir with mode 0700', () => {
    const dir = join(tmp(), 'fresh');
    loadOrCreateConfig(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('claudeDir uses CLAUDE_CONFIG_DIR when set, else ~/.claude', () => {
    expect(claudeDir({ CLAUDE_CONFIG_DIR: '/x/y' })).toBe('/x/y');
    expect(claudeDir({})).toBe(join(homedir(), '.claude'));
  });
});
