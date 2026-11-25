import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGES, classifyHello, classifyProbe, formatReply, needsEventCheck, newNonce, parseConfig, parseTicket, proofFor } from '../plugin/mod/office.js';
import { proofFor as serverProof } from '../src/server/eventServer.js';

describe('the /hello proof', () => {
  it('the plugin and the tracker compute the same proof', async () => {
    const n = newNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await proofFor('tok', n)).toBe(serverProof('tok', n));
  });
  it('classifies who answered', async () => {
    const good = await proofFor('tok', 'n'.repeat(16));
    const ok = (body: unknown) => ({ status: 200, text: JSON.stringify(body) });
    expect(classifyHello(ok({ app: 'agent-office', proof: good }), good)).toBe('proven');
    expect(classifyHello(ok({ app: 'agent-office', proof: 'x' }), good)).toBe('wrong');
    expect(classifyHello(ok({ proof: good }), good)).toBe('missing');
    expect(classifyHello({ status: 404, text: '' }, good)).toBe('missing');
    expect(classifyHello({ status: 200, text: 'not json' }, good)).toBe('missing');
    expect(classifyHello('refused', good)).toBe('refused');
  });
  it('parseTicket takes only a plausible ticket', () => {
    expect(parseTicket(JSON.stringify({ ticket: 'abcdefghijklmnop_-12' }))).toBe('abcdefghijklmnop_-12');
    expect(parseTicket(JSON.stringify({ ticket: 'short' }))).toBeUndefined();
    expect(parseTicket(JSON.stringify({ ticket: 'has spaces and <html> in it' }))).toBeUndefined();
    expect(parseTicket('nope')).toBeUndefined();
  });
});

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
    expect(classifyProbe({ status: 404 }, 404)).toBe('foreign');
    expect(classifyProbe({ status: 404 }, 401)).toBe('foreign');
    expect(classifyProbe({ status: 404 }, 'refused')).toBe('foreign');
    // a 200 that is not ours stays foreign whatever /event said
    expect(classifyProbe({ status: 200, json: { hello: 1 } }, 400)).toBe('foreign');
  });
  it('badToken: /state answers 401', () => {
    expect(classifyProbe({ status: 401, json: { version: '1', state: {} } })).toBe('badToken');
    expect(classifyProbe({ status: 401 })).toBe('badToken');
  });
  it('older: /state is not a 200 but POST /event {} answers 400', () => {
    expect(classifyProbe({ status: 404 }, 400)).toBe('older');
    expect(classifyProbe({ status: 405 }, 400)).toBe('older');
  });
  it('needsEventCheck: only a non-200, non-401 answer', () => {
    expect(needsEventCheck({ status: 404 })).toBe(true);
    expect(needsEventCheck({ status: 500 })).toBe(true);
    expect(needsEventCheck({ status: 200, json: { hello: 1 } })).toBe(false);
    expect(needsEventCheck({ status: 401 })).toBe(false);
    expect(needsEventCheck('refused')).toBe(false);
  });
  it('down: refused or timed out', () => {
    expect(classifyProbe('refused')).toBe('down');
  });
});

describe('formatReply', () => {
  const base = { port: 47999, ticket: 'tkt-abcdefghijklmnop', started: true };
  it('links with the one-time ticket, never the token', () => {
    const t = formatReply({ ...base, appInstalled: false });
    expect(t).toContain('http://127.0.0.1:47999/?ticket=tkt-abcdefghijklmnop');
    expect(t).not.toContain('token=');
    expect(t.toLowerCase()).toContain('panel');
    expect(t).not.toMatch(/desktop app/i);
  });
  it('without a ticket (an older tracker) prints no link at all', () => {
    const t = formatReply({ port: 47999, started: false, appInstalled: false });
    expect(t).not.toContain('http://');
    expect(t).toMatch(/older version/);
  });
  it('adds the app line only when the app is installed', () => {
    expect(formatReply({ ...base, appInstalled: true })).toMatch(/desktop app/i);
  });
  it('says whether it started the tracker', () => {
    expect(formatReply({ ...base, appInstalled: false })).toMatch(/started/i);
    expect(formatReply({ ...base, started: false, appInstalled: false })).not.toMatch(/started/i);
  });
});

describe('MESSAGES', () => {
  it('names an older app and a different token', () => {
    expect(MESSAGES.older(47999)).toBe('An older Agent Office app is running on port 47999. Rebuild and restart it (or quit it) to use /office.');
    expect(MESSAGES.badToken(47999)).toBe('The office tracker on port 47999 uses a different token. Restart it, or check ~/.agent-office/config.json.');
    expect(MESSAGES.launcherFailed('/x/.agent-office')).toBe("Couldn't start the office tracker (the launcher failed). See /x/.agent-office/tracker.log.");
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
