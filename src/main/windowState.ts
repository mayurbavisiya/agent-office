// Persisted window state (~/.agent-office/window.json). Pure Node fs: no Electron imports, so it is unit-testable.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type WindowState = { x?: number; y?: number; width: number; height: number; opacity: number; alwaysOnTop: boolean; compact: boolean };

export const DEFAULT_STATE: WindowState = { width: 720, height: 420, opacity: 1, alwaysOnTop: true, compact: false };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadWindowState(file: string): WindowState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_STATE };
  const r = raw as Record<string, unknown>;
  const s: WindowState = {
    width: num(r.width) && r.width >= 100 ? Math.round(r.width) : DEFAULT_STATE.width,
    height: num(r.height) && r.height >= 40 ? Math.round(r.height) : DEFAULT_STATE.height,
    opacity: num(r.opacity) ? Math.min(1, Math.max(0.3, r.opacity)) : DEFAULT_STATE.opacity,
    alwaysOnTop: typeof r.alwaysOnTop === 'boolean' ? r.alwaysOnTop : DEFAULT_STATE.alwaysOnTop,
    compact: typeof r.compact === 'boolean' ? r.compact : DEFAULT_STATE.compact,
  };
  if (num(r.x) && num(r.y)) {
    s.x = Math.round(r.x);
    s.y = Math.round(r.y);
  }
  return s;
}

export function saveWindowState(file: string, s: WindowState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}
