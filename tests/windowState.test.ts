import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWindowState, saveWindowState } from '../src/main/windowState.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ao-win-'));
const DEFAULTS = { width: 720, height: 420, opacity: 1, alwaysOnTop: true, compact: false };

describe('windowState', () => {
  it('defaults when file missing or corrupt', () => {
    const dir = tmp();
    expect(loadWindowState(join(dir, 'nope.json'))).toEqual(DEFAULTS);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(loadWindowState(bad)).toEqual(DEFAULTS);
    writeFileSync(bad, '[1,2]');
    expect(loadWindowState(bad)).toEqual(DEFAULTS);
  });

  it('round-trips saved state', () => {
    const file = join(tmp(), 'sub', 'window.json');
    const s = { x: 10, y: 20, width: 800, height: 500, opacity: 0.5, alwaysOnTop: false, compact: true };
    saveWindowState(file, s);
    expect(loadWindowState(file)).toEqual(s);
  });

  it('clamps opacity to 0.3..1', () => {
    const file = join(tmp(), 'w.json');
    saveWindowState(file, { ...DEFAULTS, opacity: 0.01 });
    expect(loadWindowState(file).opacity).toBe(0.3);
    saveWindowState(file, { ...DEFAULTS, opacity: 7 });
    expect(loadWindowState(file).opacity).toBe(1);
    writeFileSync(file, JSON.stringify({ opacity: 'x', width: -5, x: 'a' }));
    const s = loadWindowState(file);
    expect(s.opacity).toBe(1);
    expect(s.width).toBe(720);
    expect(s.x).toBeUndefined();
  });
});
