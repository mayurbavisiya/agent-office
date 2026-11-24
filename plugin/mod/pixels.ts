// Pure drawing logic for the Agent Office pane: tracker snapshot -> panel model -> Raster cells.
// No imports and no runtime APIs, so the hooks module (plugin/hooks/register.tsx) and vitest
// (tests/pixels.test.ts) both load this file as is. The plugin folder ships on its own, so the
// agent-type colours (src/scene/looks.ts) and prices (src/core/pricing.ts) are copied here;
// tests/pixels.test.ts checks the copies against the originals.

// ---- the slice of the tracker's OfficeState (src/shared/types.ts) the pane reads ----

export type AgentStatus = 'spawning' | 'working' | 'quiet' | 'handing_off' | 'gone';
export type BossStatus = 'working' | 'delegating' | 'waiting_on_team' | 'idle' | 'needs_you';
export type PxStats = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  /** tokens in the agent's memory after its latest step (see src/shared/types.ts) */
  contextTokens?: number;
  lastActivity: number;
};
export type PxAgent = {
  id: string;
  type: string;
  name?: string;
  task?: string;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  stats: PxStats;
};
export type PxSession = {
  id: string;
  label: string;
  name?: string;
  status: 'active' | 'ended';
  boss: { status: BossStatus; startedAt: number; stats: PxStats };
  agents: Record<string, PxAgent>;
  lastActivity: number;
  floorSince?: number;
};
export type PxState = { sessions: Record<string, PxSession> };
/** `tracker`: which tracker run answered (`<version>@<startedAt>`), so a restart that resets `seq` still reads as new. */
export type Snapshot = { seq: number; tracker?: string; state: PxState };

export type AnimEvent = { kind: 'spawn' | 'handoff' | 'exit'; sessionId: string; agentId: string };
/** An animation in flight: the event, the frame it began on, the walker's colour and desk slot. */
export type ActiveAnim = AnimEvent & { start: number; color: number; slot: number };
export type Chip = { label: string; sessionId: string; agentId: string | 'boss' };

export type HelperModel = { agentId: string; label: string; color: number; status: AgentStatus };
export type RoomModel = {
  sessionId: string;
  label: string;
  boss: BossStatus;
  helpers: HelperModel[];
  status: string;
  /** the room's box in cells */
  x: number;
  y: number;
  w: number;
  h: number;
};
export type PanelModel =
  | { mode: 'summary'; line: string; height: number }
  | {
      mode: 'rooms';
      arrangement: 'stacked' | 'side';
      rooms: RoomModel[];
      /** rooms that did not fit */
      more: number;
      /** where "+N more" goes: its own row, or over the end of the top row */
      moreAt: { x: number; y: number };
      /** the rows the drawing takes */
      height: number;
      anims: ActiveAnim[];
    };

// ---- copied tables ----

/** Fixed agent-type colours, as src/scene/looks.ts KNOWN. */
export const TYPE_COLORS: Record<string, number> = {
  main: 0x8b5cf6,
  explore: 0x10b981,
  plan: 0x3b82f6,
  'code-reviewer': 0xf97316,
  'general-purpose': 0xec4899,
};

/** USD per million tokens [input, output, cache read, cache write], as src/core/pricing.ts MODELS. */
export const PRICES: Record<string, [number, number, number, number]> = {
  'claude-fable-5-2': [8, 40, 0.2, 16],
  'claude-opus-5-5': [4, 20, 0.2, 8],
  'claude-sonnet-5-5': [2, 10, 0.1, 4],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.2],
};

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** The agent type's colour as 0xRRGGBB (looksFor(type).color). */
export function colorFor(type: string): number {
  const own = Object.prototype.hasOwnProperty;
  if (own.call(TYPE_COLORS, type)) return TYPE_COLORS[type]!;
  const low = type.toLowerCase();
  if (own.call(TYPE_COLORS, low)) return TYPE_COLORS[low]!;
  return hsl(hash(type) % 360, 0.62, 0.55);
}

export function estimateCost(s: PxStats): number | null {
  if (s.model === undefined || !Object.prototype.hasOwnProperty.call(PRICES, s.model)) return null;
  const [i, o, r, w] = PRICES[s.model]!;
  return (s.inputTokens * i + s.outputTokens * o + s.cacheRead * r + s.cacheWrite * w) / 1_000_000;
}

// ---- formatting ----

const DASH = '—';
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  n = Math.max(0, n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
/** tokens in memory now; undefined before the agent's first step */
const live = (s: PxStats) => s.contextTokens;

const BOSS_WORDS: Record<BossStatus, string> = {
  working: 'working',
  delegating: 'delegating',
  waiting_on_team: 'waiting on team',
  idle: 'idle',
  needs_you: 'needs you',
};
const AGENT_WORDS: Record<AgentStatus, string> = {
  spawning: 'arriving',
  working: 'working',
  quiet: 'quiet (maybe stuck)',
  handing_off: 'handing off',
  gone: 'gone',
};

// ---- parsing the tracker's body (untrusted: everything is checked) ----

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const AGENT_STATUSES: AgentStatus[] = ['spawning', 'working', 'quiet', 'handing_off', 'gone'];
const BOSS_STATUSES: BossStatus[] = ['working', 'delegating', 'waiting_on_team', 'idle', 'needs_you'];

function parseStats(v: unknown): PxStats {
  const s = isRec(v) ? v : {};
  const out: PxStats = {
    inputTokens: num(s.inputTokens),
    outputTokens: num(s.outputTokens),
    cacheRead: num(s.cacheRead),
    cacheWrite: num(s.cacheWrite),
    lastActivity: num(s.lastActivity),
  };
  const model = str(s.model);
  if (model !== undefined) out.model = model;
  if (typeof s.contextTokens === 'number' && Number.isFinite(s.contextTokens)) out.contextTokens = s.contextTokens;
  return out;
}

function parseAgent(v: unknown): PxAgent | null {
  if (!isRec(v) || typeof v.id !== 'string' || typeof v.type !== 'string') return null;
  const status = AGENT_STATUSES.includes(v.status as AgentStatus) ? (v.status as AgentStatus) : 'working';
  const a: PxAgent = { id: v.id, type: v.type, status, startedAt: num(v.startedAt), stats: parseStats(v.stats) };
  const name = str(v.name);
  const task = str(v.task);
  if (name !== undefined) a.name = name;
  if (task !== undefined) a.task = task;
  if (typeof v.endedAt === 'number') a.endedAt = v.endedAt;
  return a;
}

function parseSession(v: unknown): PxSession | null {
  if (!isRec(v) || typeof v.id !== 'string' || typeof v.label !== 'string' || !isRec(v.boss)) return null;
  const agents: Record<string, PxAgent> = {};
  if (isRec(v.agents)) {
    for (const raw of Object.values(v.agents)) {
      const a = parseAgent(raw);
      if (a) agents[a.id] = a;
    }
  }
  const bs = v.boss.status;
  const s: PxSession = {
    id: v.id,
    label: v.label,
    status: v.status === 'ended' ? 'ended' : 'active',
    boss: {
      status: BOSS_STATUSES.includes(bs as BossStatus) ? (bs as BossStatus) : 'idle',
      startedAt: num(v.boss.startedAt),
      stats: parseStats(v.boss.stats),
    },
    agents,
    lastActivity: num(v.lastActivity),
  };
  const name = str(v.name);
  if (name) s.name = name;
  if (typeof v.floorSince === 'number') s.floorSince = v.floorSince;
  return s;
}

/** The `GET /state` body to the slim snapshot the pane keeps, or null when it is not one. */
export function parseSnapshot(body: unknown): Snapshot | null {
  if (!isRec(body) || !isRec(body.state) || !isRec(body.state.sessions)) return null;
  const sessions: Record<string, PxSession> = {};
  for (const raw of Object.values(body.state.sessions)) {
    const s = parseSession(raw);
    if (s) sessions[s.id] = s;
  }
  const version = typeof body.version === 'string' ? body.version : '';
  return { seq: num(body.seq), tracker: `${version}@${num(body.startedAt)}`, state: { sessions } };
}

// ---- diffs and animations ----

/** Spawn / handoff / exit events between two snapshots; none for the first. */
export function diffStates(prev: PxState | null, next: PxState): AnimEvent[] {
  if (!prev) return [];
  const out: AnimEvent[] = [];
  for (const [sid, s] of Object.entries(next.sessions)) {
    const before = prev.sessions[sid]?.agents ?? {};
    for (const [aid, a] of Object.entries(s.agents)) {
      const was = before[aid];
      if (!was) {
        if (a.status !== 'gone') out.push({ kind: 'spawn', sessionId: sid, agentId: aid });
      } else if (a.status === 'handing_off' && was.status !== 'handing_off') {
        out.push({ kind: 'handoff', sessionId: sid, agentId: aid });
      } else if (a.status === 'gone' && was.status !== 'gone') {
        out.push({ kind: 'exit', sessionId: sid, agentId: aid });
      }
    }
    for (const [aid, was] of Object.entries(before)) {
      if (!s.agents[aid] && was.status !== 'gone') out.push({ kind: 'exit', sessionId: sid, agentId: aid });
    }
  }
  return out;
}

export const ANIM_FRAMES = 12;

const liveHelpers = (s: PxSession): PxAgent[] =>
  Object.values(s.agents)
    .filter(a => a.status !== 'gone')
    .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));

/** The events as animations from `frame` on, each with its walker's colour and desk slot. */
export function startAnims(events: AnimEvent[], prev: PxState | null, next: PxState, frame: number): ActiveAnim[] {
  return events.map(ev => {
    const from = ev.kind === 'exit' ? prev : next;
    const s = from?.sessions[ev.sessionId];
    const list = s ? liveHelpers(s) : [];
    const slot = Math.max(0, list.findIndex(a => a.id === ev.agentId));
    const a = s?.agents[ev.agentId];
    return { ...ev, start: frame, color: colorFor(a?.type ?? ''), slot };
  });
}

export const isAnimLive = (a: ActiveAnim, frame: number) => frame >= a.start && frame - a.start < ANIM_FRAMES;

// ---- layout ----

const ROOM_H = 6;
const MIN_ROOM_W = 20;
const roomLabel = (s: PxSession) => s.name || s.label;

function roomModel(s: PxSession): Omit<RoomModel, 'x' | 'y' | 'w' | 'h'> {
  const helpers = liveHelpers(s);
  const counts = [s.boss.stats, ...helpers.map(a => a.stats)].map(live).filter((n): n is number => n !== undefined);
  const tokens = counts.length ? formatTokens(counts.reduce((a, b) => a + b, 0)) : DASH;
  return {
    sessionId: s.id,
    label: roomLabel(s),
    boss: s.boss.status,
    helpers: helpers.map(a => ({ agentId: a.id, label: a.name || a.type, color: colorFor(a.type), status: a.status })),
    status: `${BOSS_WORDS[s.boss.status]} · ${helpers.length} helper${helpers.length === 1 ? '' : 's'} · ${tokens} tokens in memory`,
  };
}

function orderedSessions(state: PxState): PxSession[] {
  return Object.values(state.sessions)
    .filter(s => s.status !== 'ended')
    .sort((a, b) => (a.floorSince ?? a.lastActivity) - (b.floorSince ?? b.lastActivity) || (a.id < b.id ? -1 : 1));
}

/** Where each room goes in a `cols` x `rows` box (spec call 2), or the one-line summary. */
export function layoutPanel(state: PxState, cols: number, rows: number, anims: ActiveAnim[] = []): PanelModel {
  const sessions = orderedSessions(state);
  if (cols < 30 || rows < 4) {
    const helpers = sessions.reduce((n, s) => n + liveHelpers(s).length, 0);
    const need = sessions.filter(s => s.boss.status === 'needs_you').length;
    const parts = [`${sessions.length} room${sessions.length === 1 ? '' : 's'}`, `${helpers} helper${helpers === 1 ? '' : 's'}`];
    if (need > 0) parts.push(`${need} need${need === 1 ? 's' : ''} you`);
    return { mode: 'summary', line: parts.join(' · '), height: 1 };
  }
  const n = sessions.length;
  const rooms: RoomModel[] = [];
  let more = 0;
  let moreAt = { x: 0, y: 0 };
  let height: number;
  if (rows >= (2 * cols) / 3) {
    let fit = Math.floor(rows / ROOM_H);
    if (fit < n) fit = Math.floor((rows - 1) / ROOM_H);
    const shown = Math.min(n, fit);
    more = n - shown;
    sessions.slice(0, shown).forEach((s, i) => rooms.push({ ...roomModel(s), x: 0, y: i * ROOM_H, w: cols, h: ROOM_H }));
    moreAt = { x: 0, y: shown * ROOM_H };
    height = Math.max(1, shown * ROOM_H + (more > 0 ? 1 : 0));
    return { mode: 'rooms', arrangement: 'stacked', rooms, more, moreAt, height, anims };
  }
  const fit = Math.max(1, Math.floor((cols + 1) / (MIN_ROOM_W + 1)));
  const shown = Math.min(n, fit);
  more = n - shown;
  const w = shown > 0 ? Math.floor((cols + 1) / shown) - 1 : cols;
  const ownRow = more > 0 && rows >= 5;
  const h = Math.min(ROOM_H, ownRow ? rows - 1 : rows);
  sessions.slice(0, shown).forEach((s, i) => rooms.push({ ...roomModel(s), x: i * (w + 1), y: 0, w, h }));
  const label = `+${more} more`;
  moreAt = ownRow ? { x: 0, y: h } : { x: Math.max(0, cols - label.length), y: 0 };
  height = ownRow ? h + 1 : h;
  return { mode: 'rooms', arrangement: 'side', rooms, more, moreAt, height, anims };
}

// ---- sprites ----

export type SpriteKind =
  | 'boss-typing'
  | 'boss-idle'
  | 'boss-lean'
  | 'boss-alert'
  | 'helper-working'
  | 'helper-quiet'
  | 'helper-walk'
  | 'desk'
  | 'door'
  | 'bang'
  | 'zzz'
  | 'paper';
export type Sprite = { rows: string[] };

// Legend: H hair, F skin, S shirt (the boss's suit, a helper's type colour), T tie, P trousers,
// K shoes, M monitor, C screen, D desk top, d desk legs, w door frame, W door, O knob, ! alert,
// Z sleep, N paper; '.' is transparent.
const PERSON = {
  typingA: ['.HHH.', '.FFF.', 'SSTSS', 'FSTSS', '.STS.', '.P.P.', '.K.K.'],
  typingB: ['.HHH.', '.FFF.', 'SSTSS', 'SSTSF', '.STS.', '.P.P.', '.K.K.'],
  idle: ['.HHH.', '.FFF.', 'SSTSS', 'SSTSS', '.STS.', '.P.P.', '.K.K.'],
  lean: ['..HHH', '..FFF', '.SSTS', '.SSTS', '.STS.', '.P.P.', '.K.K.'],
  alert: ['FHHH.', 'SFFF.', 'SSTSS', '.STSS', '.STS.', '.P.P.', '.K.K.'],
  walkA: ['.HHH.', '.FFF.', 'SSTSS', 'FSTSF', '.STS.', '.P.P.', '.K.K.'],
  walkB: ['.HHH.', '.FFF.', 'SSTSS', 'FSTSF', '.STS.', 'P...P', 'K...K'],
};
const noTie = (rows: string[]) => rows.map(r => r.replace(/T/g, 'S'));
const SPRITES: Record<SpriteKind, (frame: number) => string[]> = {
  'boss-typing': f => (f % 2 === 0 ? PERSON.typingA : PERSON.typingB),
  'boss-idle': () => PERSON.idle,
  'boss-lean': () => PERSON.lean,
  'boss-alert': () => PERSON.alert,
  'helper-working': f => noTie(f % 2 === 0 ? PERSON.typingA : PERSON.typingB),
  'helper-quiet': () => noTie(['.....', '.HHH.', 'SFFFS', 'SSSSS', '.SSS.', '.P.P.', '.K.K.']),
  'helper-walk': f => noTie(f % 2 === 0 ? PERSON.walkA : PERSON.walkB),
  desk: () => ['.MMMM.', '.MCCM.', 'DDDDDD', 'd....d', 'd....d'],
  door: () => ['wwww', 'wWWw', 'wWWw', 'wWWw', 'wWOw', 'wWWw', 'wWWw'],
  bang: () => ['!', '!', '.', '!'],
  zzz: () => ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'],
  paper: () => ['NN'],
};

export function spriteFor(kind: SpriteKind, frame: number): Sprite {
  return { rows: SPRITES[kind](frame) };
}

const PALETTE: Record<string, number> = {
  H: 0x3b2a20,
  F: 0xeab38c,
  T: 0xd9455f,
  P: 0x2e2b45,
  K: 0x1f1a17,
  M: 0x2b2b38,
  C: 0x7dd3fc,
  D: 0x8b6b4a,
  d: 0x5e4630,
  w: 0x4a3220,
  W: 0x6b4a2f,
  O: 0xf2c94c,
  '!': 0xff5d5d,
  Z: 0xc7d2fe,
  N: 0xf5f5f5,
};
const BOSS_SUIT = 0x3d3a5c;
const WALL = 0x2f2a45;
const FLOOR = 0x4a3f35;
const LABEL_FG = 0xe9e6ff;
const LABEL_BG = 0x221e36;
const STATUS_FG = 0xb8b3d6;
const STATUS_BG = 0x1a1729;
const SCREEN_LIT = 0xbae6fd;
const SCREEN_OFF = 0x1e293b;
const DEFAULT = 0x01000000;

// ---- canvas ----

type Clip = { x0: number; y0: number; x1: number; y1: number };

class Canvas {
  readonly px: Uint32Array;
  readonly cp: Uint32Array;
  readonly fg: Uint32Array;
  readonly bg: Uint32Array;
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.px = new Uint32Array(cols * rows * 2).fill(DEFAULT);
    this.cp = new Uint32Array(cols * rows);
    this.fg = new Uint32Array(cols * rows);
    this.bg = new Uint32Array(cols * rows);
  }
  fill(c: Clip, color: number): void {
    for (let y = Math.max(0, c.y0); y < Math.min(this.rows * 2, c.y1); y++) {
      for (let x = Math.max(0, c.x0); x < Math.min(this.cols, c.x1); x++) this.px[y * this.cols + x] = color;
    }
  }
  /** Draws `rows` with its bottom-left pixel at (x, bottom), inside `clip`. */
  sprite(rows: string[], x: number, bottom: number, clip: Clip, colors: Record<string, number>): void {
    const top = bottom - rows.length + 1;
    rows.forEach((line, j) => {
      const y = top + j;
      if (y < clip.y0 || y >= clip.y1 || y < 0 || y >= this.rows * 2) return;
      for (let i = 0; i < line.length; i++) {
        const xx = x + i;
        const ch = line[i]!;
        if (ch === '.' || xx < clip.x0 || xx >= clip.x1 || xx < 0 || xx >= this.cols) continue;
        const color = colors[ch] ?? PALETTE[ch];
        if (color !== undefined) this.px[y * this.cols + xx] = color;
      }
    });
  }
  /** Writes `text` on cell row `y` from column `x`, cut to `w` cells (an ellipsis marks a cut). */
  text(x: number, y: number, w: number, text: string, fg: number, bg: number, pad = true): void {
    if (y < 0 || y >= this.rows) return;
    const glyphs = clipText(text, w);
    const end = pad ? w : glyphs.length;
    for (let i = 0; i < end; i++) {
      const xx = x + i;
      if (xx < 0 || xx >= this.cols) continue;
      const k = y * this.cols + xx;
      this.cp[k] = glyphs[i] ?? 0x20;
      this.fg[k] = fg;
      this.bg[k] = bg;
    }
  }
  encode(): string {
    const n = this.cols * this.rows;
    const bytes = new Uint8Array(n * 12);
    const view = new DataView(bytes.buffer);
    for (let k = 0; k < n; k++) {
      let cp = this.cp[k]!;
      let fg = this.fg[k]!;
      let bg = this.bg[k]!;
      if (cp === 0) {
        const cx = k % this.cols;
        const cy = (k - cx) / this.cols;
        const top = this.px[cy * 2 * this.cols + cx]!;
        const bot = this.px[(cy * 2 + 1) * this.cols + cx]!;
        if (top === DEFAULT && bot === DEFAULT) [cp, fg, bg] = [0x20, DEFAULT, DEFAULT];
        else [cp, fg, bg] = [0x2580, top, bot];
      }
      view.setUint32(k * 12, cp, true);
      view.setUint32(k * 12 + 4, fg, true);
      view.setUint32(k * 12 + 8, bg, true);
    }
    return base64(bytes);
  }
}

/** Whether a Raster can draw `cp` as one cell: a conservative list of width-1 BMP ranges. */
function drawable(cp: number): boolean {
  return (
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa1 && cp <= 0x24f) ||
    (cp >= 0x370 && cp <= 0x52f) ||
    (cp >= 0x2010 && cp <= 0x2027) ||
    (cp >= 0x2500 && cp <= 0x259f)
  );
}

/** `text` as at most `w` drawable code points, control characters as spaces, the rest as '?'. */
export function clipText(text: string, w: number): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x300 && cp <= 0x36f) continue; // combining marks
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0xa0)) out.push(0x20);
    else out.push(drawable(cp) ? cp : 0x3f);
  }
  if (out.length <= w) return out;
  return w <= 0 ? [] : [...out.slice(0, w - 1), 0x2026];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let line = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    line += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    line += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    line += i + 2 < bytes.length ? B64[c & 63]! : '=';
    if (line.length >= 4096) {
      parts.push(line);
      line = '';
    }
  }
  parts.push(line);
  return parts.join('');
}

// ---- drawing ----

const blinkOn = (frame: number) => Math.floor(frame / 2) % 2 === 0;
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
const SLOT_W = 11;

function drawRoom(cv: Canvas, room: RoomModel, frame: number, anims: ActiveAnim[]): void {
  const { x, y, w, h } = room;
  cv.text(x, y, w, room.label, LABEL_FG, LABEL_BG);
  if (h >= 3) cv.text(x, y + h - 1, w, room.status, STATUS_FG, STATUS_BG);
  const artRows = Math.max(0, h - (h >= 3 ? 2 : 1));
  if (artRows === 0) return;
  const py0 = (y + 1) * 2;
  const ph = artRows * 2;
  const clip: Clip = { x0: x, y0: py0, x1: x + w, y1: py0 + ph };
  const feet = py0 + ph - 1;
  cv.fill({ ...clip, y1: py0 + Math.max(1, ph - 3) }, WALL);
  cv.fill({ ...clip, y0: py0 + Math.max(1, ph - 3) }, FLOOR);

  const doorX = x + 1;
  cv.sprite(spriteFor('door', frame).rows, doorX, feet, clip, {});

  const mine = anims.filter(a => a.sessionId === room.sessionId && isAnimLive(a, frame));
  const bossX = x + 6;
  const handing = mine.find(a => a.kind === 'handoff');
  const bounce = handing && frame - handing.start >= ANIM_FRAMES - 3 ? 1 : 0;
  const bossKind: SpriteKind =
    room.boss === 'needs_you'
      ? 'boss-alert'
      : room.boss === 'waiting_on_team'
        ? 'boss-lean'
        : room.boss === 'idle'
          ? 'boss-idle'
          : 'boss-typing';
  const bossTyping = bossKind === 'boss-typing';
  cv.sprite(spriteFor('desk', frame).rows, bossX + 5, feet, clip, bossTyping && frame % 2 === 1 ? { C: SCREEN_LIT } : {});
  cv.sprite(spriteFor(bossKind, frame).rows, bossX, feet - bounce, clip, { S: BOSS_SUIT });
  if (room.boss === 'needs_you' && blinkOn(frame)) cv.sprite(spriteFor('bang', frame).rows, bossX - 1, feet - 3, clip, {});

  const slotX = (i: number) => bossX + SLOT_W + i * SLOT_W;
  const fits = (i: number) => slotX(i) + SLOT_W <= x + w;
  room.helpers.forEach((hm, i) => {
    if (!fits(i)) return;
    const hx = slotX(i);
    const working = hm.status === 'working';
    cv.sprite(spriteFor('desk', frame).rows, hx + 5, feet, clip, hm.status === 'quiet' ? { C: SCREEN_OFF } : working && (frame + i) % 2 === 1 ? { C: SCREEN_LIT } : {});
    const spawn = mine.find(a => a.kind === 'spawn' && a.agentId === hm.agentId);
    if (spawn) {
      const t = (frame - spawn.start) / (ANIM_FRAMES - 2);
      cv.sprite(spriteFor('helper-walk', frame).rows, lerp(doorX, hx, t), feet, clip, { S: hm.color });
      return;
    }
    const kind: SpriteKind = hm.status === 'quiet' ? 'helper-quiet' : working ? 'helper-working' : 'helper-walk';
    cv.sprite(spriteFor(kind, kind === 'helper-walk' ? 0 : frame + i).rows, hx, feet, clip, { S: hm.color });
    if (hm.status === 'quiet') cv.sprite(spriteFor('zzz', frame).rows, hx + 6, feet - 4 - (blinkOn(frame) ? 0 : 1), clip, {});
    const hand = mine.find(a => a.kind === 'handoff' && a.agentId === hm.agentId);
    if (hand) {
      const t = (frame - hand.start) / (ANIM_FRAMES - 3);
      cv.sprite(spriteFor('paper', frame).rows, lerp(hx, bossX + 4, t), feet - 3, clip, {});
    }
  });
  for (const ex of mine) {
    if (ex.kind !== 'exit' || !fits(ex.slot)) continue;
    const t = (frame - ex.start) / (ANIM_FRAMES - 2);
    if (t >= 1) continue;
    cv.sprite(spriteFor('helper-walk', frame).rows, lerp(slotX(ex.slot), doorX, t), feet, clip, { S: ex.color });
  }
}

/** A label cut to `max` characters (default 18, as fitChips counts), an ellipsis marking the cut. */
export function clipLabel(label: string, max = 18): string {
  const chars = [...label.replace(/\s+/g, ' ')];
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

/** The chips for the visible rooms' characters, boss first in each room. */
export function chipsOf(model: PanelModel): Chip[] {
  if (model.mode !== 'rooms') return [];
  return model.rooms.flatMap(r => [
    { label: `${clipLabel(r.label.trim() || DASH, 12)}: boss`, sessionId: r.sessionId, agentId: 'boss' as const },
    ...r.helpers.map(h => ({ label: h.label, sessionId: r.sessionId, agentId: h.agentId })),
  ]);
}

/** The model drawn into `cols` x `rows` cells (RasterProps encoding), and its chips. */
export function renderFrame(model: PanelModel, cols: number, rows: number, frame: number): { cells: string; chips: Chip[] } {
  const cv = new Canvas(Math.max(1, cols), Math.max(1, rows));
  if (model.mode === 'summary') {
    cv.text(0, 0, cols, model.line, LABEL_FG, DEFAULT);
  } else if (model.rooms.length === 0) {
    cv.text(0, 0, cols, 'No Claude Code sessions yet.', STATUS_FG, DEFAULT);
  } else {
    for (const room of model.rooms) drawRoom(cv, room, frame, model.anims);
    if (model.more > 0) cv.text(model.moreAt.x, model.moreAt.y, cols - model.moreAt.x, `+${model.more} more`, LABEL_FG, STATUS_BG, false);
  }
  return { cells: cv.encode(), chips: chipsOf(model) };
}

/** Whether a frame of this model moves (typing, blinking, sleeping or an animation in flight). */
export function isMoving(model: PanelModel, frame: number): boolean {
  if (model.mode !== 'rooms') return false;
  if (model.anims.some(a => isAnimLive(a, frame))) return true;
  return model.rooms.some(r => r.boss !== 'idle' && r.boss !== 'waiting_on_team' ? true : r.helpers.some(h => h.status === 'working' || h.status === 'quiet'));
}

// ---- chips and details ----

/** The chips that fit in `maxRows` rows of `cols` (a chip takes its label plus 3 cells), and how many did not. */
export function fitChips(chips: Chip[], cols: number, maxRows: number): { shown: Chip[]; hidden: number } {
  const room = Math.max(0, cols - 4); // keep space for "+N"
  const shown: Chip[] = [];
  let row = 1;
  let used = 0;
  for (const c of chips) {
    const w = Math.min(c.label.length, 18) + 3;
    if (used + w > room) {
      if (row >= maxRows) break;
      row++;
      used = 0;
    }
    if (w > room) break;
    shown.push(c);
    used += w;
  }
  return { shown, hidden: chips.length - shown.length };
}

const running = (start: number, end: number) => `running: ${start > 0 ? formatDuration(end - start) : DASH}`;

export type Details = { title: string; lines: string[] };

/** What a pressed chip shows, or null once that character left. */
export function detailsFor(state: PxState, sel: { sessionId: string; agentId: string }, now: number): Details | null {
  const s = state.sessions[sel.sessionId];
  if (!s) return null;
  const tokens = (st: PxStats) => {
    const m = live(st);
    return `memory now: ${m === undefined ? DASH : formatTokens(m)} tokens · written: ${formatTokens(st.outputTokens)}`;
  };
  const billing = (st: PxStats) =>
    `billing totals: in ${formatTokens(st.inputTokens)} · out ${formatTokens(st.outputTokens)} · cache ${formatTokens(st.cacheRead + st.cacheWrite)}`;
  const cost = (st: PxStats) => {
    const c = estimateCost(st);
    return c === null ? `cost: ${DASH} (unknown model)` : `cost: ~$${c.toFixed(3)} (estimate)`;
  };
  const last = (st: PxStats) => (st.lastActivity > 0 ? `last activity: ${formatDuration(now - st.lastActivity)} ago` : `last activity: ${DASH}`);
  if (sel.agentId === 'boss') {
    const st = s.boss.stats;
    return {
      title: `boss · ${roomLabel(s)}`,
      lines: [
        'type: main agent',
        `status: ${BOSS_WORDS[s.boss.status]}`,
        tokens(st),
        billing(st),
        cost(st),
        running(s.boss.startedAt, now),
        last(st),
      ],
    };
  }
  const a = s.agents[sel.agentId];
  if (!a) return null;
  const st = a.stats;
  return {
    title: a.name ? `${a.name} (${a.type})` : a.type,
    lines: [
      `type: ${a.type}`,
      `task: ${a.task ?? DASH}`,
      `status: ${AGENT_WORDS[a.status]}`,
      tokens(st),
      billing(st),
      cost(st),
      running(a.startedAt, a.endedAt ?? now),
      last(st),
    ],
  };
}

/** One text line per room, for surfaces that draw no Raster. */
export function textRooms(model: PanelModel): string[] {
  if (model.mode === 'summary') return [model.line];
  const lines = model.rooms.map(r => `${r.label}: ${r.status}`);
  if (model.more > 0) lines.push(`+${model.more} more`);
  return lines;
}
