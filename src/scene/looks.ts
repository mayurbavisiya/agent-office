// Pure, DOM-free look/mapping helpers for the office scene (tested under node).
import type { AgentStats, AgentStatus, BossStatus } from '../shared/types.js';

export type Mood = 'happy' | 'focus' | 'worried' | 'sleepy';
export type Pose = 'type' | 'scratch' | 'carry' | 'wave' | 'walk' | 'raise_hand' | 'stand';
export type Screen = 'code' | 'err';
/** Status overlays drawn around a character. */
export type Fx = 'none' | 'stuck' | 'zzz' | 'alert' | 'tap' | 'loop';

export type Look = { color: string };
export type StatusLook = { pose: Pose; mood: Mood; screen: Screen; fx: Fx; dim: boolean };

/** Fixed looks, colors taken from the approved mockup. */
const KNOWN: Record<string, Look> = {
  main: { color: '#8b5cf6' },
  explore: { color: '#10b981' },
  plan: { color: '#3b82f6' },
  'code-reviewer': { color: '#f97316' },
  'general-purpose': { color: '#ec4899' },
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
  return { color: hslToHex(hash(type) % 360, 0.62, 0.55) };
}

export type HairStyle = 'short' | 'long' | 'bun' | 'bald' | 'curly';
export type HumanLook = { skin: string; hair: string; hairStyle: HairStyle; shirt: string; pants: string; tie?: string };
export type PoseClass = 'pose-type' | 'pose-slump' | 'pose-wave' | 'pose-lean' | 'pose-idle';

const SKINS = ['#f6d3b3', '#eab38c', '#d39a6a', '#b07247', '#8a5332', '#5e3a22'];
const HAIRS = ['#1f1a17', '#3b2a20', '#6b3e26', '#a0522d', '#d6a75c', '#8f8f99'];
const HAIR_STYLES: HairStyle[] = ['short', 'long', 'bun', 'bald', 'curly'];
const PANTS = ['#4a4766', '#2f3b52', '#5a4a3a', '#3f3f46'];
const pick = <T>(list: T[], h: number): T => list[h % list.length]!;

/**
 * A flat-vector office person for a character id: skin, hair and trousers come from a stable hash
 * of the id; the shirt is the agent-type colour. The boss ('boss' type) wears a dark suit and a tie.
 */
export function humanLook(id: string, type: string | 'boss'): HumanLook {
  const h = hash(id);
  const skin = pick(SKINS, h);
  const hair = pick(HAIRS, hash('hair:' + id));
  const hairStyle = pick(HAIR_STYLES, hash('style:' + id));
  if (type === 'boss') return { skin, hair, hairStyle, shirt: '#3d3a5c', pants: '#2e2b45', tie: '#d9455f' };
  return { skin, hair, hairStyle, shirt: looksFor(type).color, pants: pick(PANTS, hash('pants:' + id)) };
}

/** The rig pose for a status look (see agentLook / bossLook). */
export function poseClass(look: StatusLook, isBoss: boolean): PoseClass {
  if (look.pose === 'type') return 'pose-type';
  if (look.fx === 'stuck') return 'pose-slump';
  if (look.pose === 'raise_hand') return 'pose-wave';
  if (isBoss && look.fx === 'tap') return 'pose-lean';
  return 'pose-idle';
}

/**
 * `waiting`: the agent is blocked on the person (its permission prompt or question is open).
 * `looping`: it keeps making the same tool call. Waiting wins: the person can unblock that one.
 */
export function agentLook(status: AgentStatus, waiting = false, looping = false): StatusLook {
  const present = status !== 'handing_off' && status !== 'gone';
  if (waiting && present) return { pose: 'raise_hand', mood: 'worried', screen: 'code', fx: 'alert', dim: false };
  if (looping && present) return { pose: 'type', mood: 'worried', screen: 'err', fx: 'loop', dim: false };
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

/** Tokens in the agent's memory right now (the headline number), or undefined before its first API call. */
export function liveTokens(s: AgentStats): number | undefined {
  return typeof s.contextTokens === 'number' && Number.isFinite(s.contextTokens) ? s.contextTokens : undefined;
}

/** What a name tag says about an agent's tool calls, or undefined: a loop, or a call running for a while. */
export const RUNNING_AFTER_MS = 30_000;
export function toolNote(o: { tool?: { name: string; since: number }; looping?: { tool: string; count: number } }, now: number): { text: string; since?: number; kind: 'looping' | 'running' } | undefined {
  if (o.looping) return { text: `↻ looping? ${o.looping.tool} ×${o.looping.count}`, kind: 'looping' };
  if (o.tool && now - o.tool.since >= RUNNING_AFTER_MS) return { text: `⏳ running ${o.tool.name} · {t}`, since: o.tool.since, kind: 'running' };
  return undefined;
}

/** Which characters have a "running" note right now ("sid/agent" keys): when this changes, redraw. */
export function runningKey(state: { sessions: Record<string, { id: string; boss: { tool?: { since: number } }; agents: Record<string, { id: string; tool?: { since: number } }> }> } | undefined, now: number): string {
  const keys: string[] = [];
  for (const s of Object.values(state?.sessions ?? {})) {
    if (s.boss.tool && now - s.boss.tool.since >= RUNNING_AFTER_MS) keys.push(`${s.id}/boss`);
    for (const a of Object.values(s.agents)) if (a.tool && now - a.tool.since >= RUNNING_AFTER_MS) keys.push(`${s.id}/${a.id}`);
  }
  return keys.sort().join(' ');
}

/** "m:ss" for a duration in ms. */
export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
