// Pure, DOM-free look/mapping helpers for the office scene (tested under node).
import type { AgentStats, AgentStatus, BossStatus } from '../shared/types.js';

export type Accessory = 'crown' | 'headphones' | 'glasses' | 'notepad' | 'hat' | 'none';
export type Mood = 'happy' | 'focus' | 'worried' | 'sleepy';
export type Pose = 'type' | 'scratch' | 'carry' | 'wave' | 'walk' | 'raise_hand' | 'stand';
export type Screen = 'code' | 'err';
/** Status overlays drawn around a character. */
export type Fx = 'none' | 'stuck' | 'zzz' | 'alert' | 'tap';

export type Look = { color: string; accessory: Accessory };
export type StatusLook = { pose: Pose; mood: Mood; screen: Screen; fx: Fx; dim: boolean };

/** Fixed looks, colors taken from the approved mockup. */
const KNOWN: Record<string, Look> = {
  main: { color: '#8b5cf6', accessory: 'crown' },
  explore: { color: '#10b981', accessory: 'headphones' },
  plan: { color: '#3b82f6', accessory: 'notepad' },
  'code-reviewer': { color: '#f97316', accessory: 'glasses' },
  'general-purpose': { color: '#ec4899', accessory: 'hat' },
};

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function looksFor(type: string): Look {
  const known = KNOWN[type] ?? KNOWN[type.toLowerCase()];
  if (known) return { ...known };
  return { color: hslToHex(hash(type) % 360, 0.62, 0.55), accessory: 'none' };
}

export function agentLook(status: AgentStatus): StatusLook {
  switch (status) {
    case 'quiet':
      return { pose: 'scratch', mood: 'worried', screen: 'err', fx: 'stuck', dim: false };
    case 'spawning':
    case 'handing_off':
      return { pose: 'stand', mood: 'happy', screen: 'code', fx: 'none', dim: false };
    case 'working':
    case 'gone':
    default:
      return { pose: 'type', mood: 'focus', screen: 'code', fx: 'none', dim: false };
  }
}

export function bossLook(status: BossStatus): StatusLook {
  switch (status) {
    case 'idle':
      return { pose: 'stand', mood: 'sleepy', screen: 'code', fx: 'zzz', dim: true };
    case 'needs_you':
      return { pose: 'raise_hand', mood: 'worried', screen: 'code', fx: 'alert', dim: false };
    case 'waiting_on_team':
      return { pose: 'stand', mood: 'happy', screen: 'code', fx: 'tap', dim: false };
    case 'working':
    case 'delegating':
    default:
      return { pose: 'type', mood: 'happy', screen: 'code', fx: 'none', dim: false };
  }
}

/** Collapses whitespace and cuts to `max` characters including a trailing ellipsis. */
export function truncate(text: string | undefined, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function totalTokens(s: AgentStats): number {
  return s.inputTokens + s.outputTokens + s.cacheWrite;
}

/** "m:ss" for a duration in ms. */
export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
