import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyProbe, formatReply, parseConfig } from '../plugin/mod/office.js';

describe('parseConfig', () => {
  it('reads port and token', () => {
    expect(parseConfig(JSON.stringify({ port: 47999, token: 'abc' }))).toEqual({ port: 47999, token: 'abc' });
  });
  it('rejects garbage', () => {
    expect(parseConfig('not json')).toBeNull();
    expect(parseConfig('[]')).toBeNull();
    expect(parseConfig('null')).toBeNull();
    expect(parseConfig('')).toBeNull();
  });
  it('rejects a missing or empty token and a bad port', () => {
    expect(parseConfig(JSON.stringify({ port: 47999 }))).toBeNull();
    expect(parseConfig(JSON.stringify({ port: 47999, token: '' }))).toBeNull();
    expect(parseConfig(JSON.stringify({ port: 'x', token: 'abc' }))).toBeNull();
    expect(parseConfig(JSON.stringify({ port: 0, token: 'abc' }))).toBeNull();
    expect(parseConfig(JSON.stringify({ port: 70000, token: 'abc' }))).toBeNull();
    expect(parseConfig(JSON.stringify({ port: 1.5, token: 'abc' }))).toBeNull();
  });
});

describe('classifyProbe', () => {
  it('ours: 200 with version and state', () => {
    expect(classifyProbe({ status: 200, json: { version: '0.1.0', startedBy: 'plugin', seq: 1, state: { sessions: {} } } })).toBe('ours');
  });
  it('foreign: any other answer', () => {
    expect(classifyProbe({ status: 200, json: { hello: 1 } })).toBe('foreign');
    expect(classifyProbe({ status: 200 })).toBe('foreign');
    expect(classifyProbe({ status: 200, json: 'text' })).toBe('foreign');
    expect(classifyProbe({ status: 404 })).toBe('foreign');
    expect(classifyProbe({ status: 401, json: { version: '1', state: {} } })).toBe('foreign');
  });
  it('down: refused or timed out', () => {
    expect(classifyProbe('refused')).toBe('down');
  });
});

describe('formatReply', () => {
  const base = { port: 47999, token: 'tok123', started: true };
  it('includes the full-office link', () => {
    const t = formatReply({ ...base, appInstalled: false });
    expect(t).toContain('http://127.0.0.1:47999/?token=tok123');
    expect(t.toLowerCase()).toContain('panel');
    expect(t).not.toMatch(/desktop app/i);
  });
  it('adds the app line only when the app is installed', () => {
    expect(formatReply({ ...base, appInstalled: true })).toMatch(/desktop app/i);
  });
  it('says whether it started the tracker', () => {
    expect(formatReply({ ...base, appInstalled: false })).toMatch(/started/i);
    expect(formatReply({ ...base, started: false, appInstalled: false })).not.toMatch(/started/i);
  });
});

describe('plugin manifest', () => {
  it('keeps its version in step with package.json (the tracker reports the latter)', () => {
    const root = join(import.meta.dirname, '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const plugin = JSON.parse(readFileSync(join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    expect(plugin).toBe(pkg);
  });
});
