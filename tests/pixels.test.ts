import { describe, it, expect } from 'vitest';
import type { Agent, AgentStatus, BossStatus, OfficeState, Session } from '../src/shared/types.js';
import { looksFor } from '../src/scene/looks.js';
import { MODELS } from '../src/core/pricing.js';
import {
  PRICES,
  chipsOf,
  clipLabel,
  TYPE_COLORS,
  colorFor,
  detailsFor,
  diffStates,
  fitChips,
  layoutPanel,
  parseSnapshot,
  renderFrame,
  spriteFor,
  startAnims,
} from '../plugin/mod/pixels.js';

const stats = (over: Partial<Agent['stats']> = {}): Agent['stats'] => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tools: {},
  files: [],
  recent: [],
  lastActivity: 0,
  ...over,
});

function agent(sessionId: string, id: string, type = 'Explore', status: AgentStatus = 'working', over: Partial<Agent> = {}): Agent {
  return { id, sessionId, parentId: null, type, status, startedAt: 1000, stats: stats(), ...over };
}

function session(id: string, over: Partial<Session> = {}, agents: Agent[] = [], boss: BossStatus = 'working'): Session {
  return {
    id,
    cwd: `/w/${id}`,
    label: `folder-${id}`,
    status: 'active',
    boss: { status: boss, startedAt: 1000, stats: stats() },
    agents: Object.fromEntries(agents.map(a => [a.id, a])),
    lastActivity: 1000,
    floorSince: 1000,
    ...over,
  };
}

function office(n: number, perRoom = 1): OfficeState {
  const sessions: Record<string, Session> = {};
  for (let i = 0; i < n; i++) {
    const id = `s${i}`;
    const agents = Array.from({ length: perRoom }, (_, j) => agent(id, `${id}-a${j}`));
    sessions[id] = session(id, { floorSince: 1000 + i }, agents);
  }
  return { sessions };
}

/** The cells string back to one line of glyphs per row. */
function cellText(cells: string, cols: number): string[] {
  const buf = Buffer.from(cells, 'base64');
  const out: string[] = [];
  const count = buf.length / 12;
  let row = '';
  for (let i = 0; i < count; i++) {
    row += String.fromCharCode(buf.readUInt32LE(i * 12));
    if ((i + 1) % cols === 0) {
      out.push(row);
      row = '';
    }
  }
  return out;
}

describe('diffStates', () => {
  it('a new agent is a spawn', () => {
    const prev = { sessions: { s: session('s') } };
    const next = { sessions: { s: session('s', {}, [agent('s', 'a1')]) } };
    expect(diffStates(prev, next)).toEqual([{ kind: 'spawn', sessionId: 's', agentId: 'a1' }]);
  });
  it('a status turning handing_off is a handoff', () => {
    const prev = { sessions: { s: session('s', {}, [agent('s', 'a1')]) } };
    const next = { sessions: { s: session('s', {}, [agent('s', 'a1', 'Explore', 'handing_off')]) } };
    expect(diffStates(prev, next)).toEqual([{ kind: 'handoff', sessionId: 's', agentId: 'a1' }]);
  });
  it('a removed agent, or one gone, is an exit', () => {
    const prev = { sessions: { s: session('s', {}, [agent('s', 'a1'), agent('s', 'a2')]) } };
    const next = { sessions: { s: session('s', {}, [agent('s', 'a2', 'Explore', 'gone')]) } };
    const got = diffStates(prev, next).sort((a, b) => (a.agentId < b.agentId ? -1 : 1));
    expect(got).toEqual([
      { kind: 'exit', sessionId: 's', agentId: 'a1' },
      { kind: 'exit', sessionId: 's', agentId: 'a2' },
    ]);
  });
  it('nothing changed is no event', () => {
    const s = { sessions: { s: session('s', {}, [agent('s', 'a1')]) } };
    expect(diffStates(s, structuredClone(s))).toEqual([]);
  });
  it('the first snapshot animates nothing', () => {
    expect(diffStates(null, office(2))).toEqual([]);
  });
});

describe('chipsOf', () => {
  it('falls back to a dash for a room with an empty label', () => {
    const st: OfficeState = { sessions: { s0: session('s0', { label: '' }) } };
    const m = layoutPanel(st, 40, 40);
    expect(chipsOf(m)[0]!.label).toBe('—: boss');
  });
});

describe('layoutPanel', () => {
  it('40x40 with 3 sessions stacks 3 rooms', () => {
    const m = layoutPanel(office(3), 40, 40);
    expect(m.mode).toBe('rooms');
    if (m.mode !== 'rooms') return;
    expect(m.arrangement).toBe('stacked');
    expect(m.rooms).toHaveLength(3);
    expect(new Set(m.rooms.map(r => r.x))).toEqual(new Set([0]));
    expect(m.rooms[1]!.y).toBeGreaterThan(m.rooms[0]!.y);
    expect(m.more).toBe(0);
  });
  it('120x8 with 3 sessions puts them side by side', () => {
    const m = layoutPanel(office(3), 120, 8);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.arrangement).toBe('side');
    expect(m.rooms).toHaveLength(3);
    expect(new Set(m.rooms.map(r => r.y))).toEqual(new Set([0]));
    expect(m.rooms[1]!.x).toBeGreaterThan(m.rooms[0]!.x);
  });
  it('40x10 with 6 sessions shows +N more', () => {
    const m = layoutPanel(office(6), 40, 10);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.rooms.length + m.more).toBe(6);
    expect(m.more).toBeGreaterThan(0);
    const rows = cellText(renderFrame(m, 40, m.height, 0).cells, 40);
    expect(rows.join('\n')).toContain(`+${m.more} more`);
  });
  it('20x5 gives the summary mode', () => {
    const m = layoutPanel(office(3), 20, 5);
    expect(m.mode).toBe('summary');
    const m2 = layoutPanel(office(3), 80, 3);
    expect(m2.mode).toBe('summary');
  });
  it('orders rooms as the floor does and labels them by name, else folder', () => {
    const st = office(2);
    st.sessions.s0!.floorSince = 5000;
    st.sessions.s1!.name = 'my session';
    const m = layoutPanel(st, 40, 40);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.rooms.map(r => r.label)).toEqual(['my session', 'folder-s0']);
  });
  it('builds the status line from boss state, helpers and tokens', () => {
    const st = { sessions: { s: session('s', {}, [agent('s', 'a', 'Explore', 'working', { stats: stats({ inputTokens: 1500, contextTokens: 1500 }) })], 'needs_you') } };
    st.sessions.s.boss.stats.outputTokens = 500;
    st.sessions.s.boss.stats.contextTokens = 500;
    const m = layoutPanel(st, 40, 40);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.rooms[0]!.status).toBe('needs you · 1 helper · 2.0k tokens in memory');
  });
  it('shows "—" tokens before any agent has finished a step', () => {
    const st = { sessions: { s: session('s', {}, [], 'working') } };
    const m = layoutPanel(st, 40, 40);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.rooms[0]!.status).toBe('working · 0 helpers · — tokens in memory');
  });
  it('leaves gone helpers out and colours helpers by type', () => {
    const st = { sessions: { s: session('s', {}, [agent('s', 'a', 'Plan'), agent('s', 'b', 'Explore', 'gone')]) } };
    const m = layoutPanel(st, 40, 40);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    expect(m.rooms[0]!.helpers.map(h => h.agentId)).toEqual(['a']);
    expect(m.rooms[0]!.helpers[0]!.color).toBe(0x3b82f6);
  });
});

describe('renderFrame', () => {
  it('packs cols*rows cells of 12 bytes each', () => {
    const m = layoutPanel(office(3, 2), 60, 40);
    const { cells } = renderFrame(m, 60, 18, 3);
    expect(Buffer.from(cells, 'base64').length).toBe(60 * 18 * 12);
  });
  it('clips every label to its room', () => {
    const st = office(3);
    st.sessions.s0!.name = 'x'.repeat(200);
    st.sessions.s1!.name = 'y'.repeat(200);
    const m = layoutPanel(st, 120, 8);
    if (m.mode !== 'rooms') throw new Error(m.mode);
    const rows = cellText(renderFrame(m, 120, m.height, 0).cells, 120);
    const r0 = m.rooms[0]!;
    const r1 = m.rooms[1]!;
    const top = rows[r0.y]!;
    expect(top.slice(r0.x, r0.x + r0.w)).toMatch(/^x+…$/);
    expect(top.slice(r1.x, r1.x + r1.w)).toMatch(/^y+…$/);
    expect(top.slice(r0.x + r0.w, r1.x)).not.toContain('x');
  });
  it('replaces glyphs a Raster cannot draw', () => {
    const st = office(1);
    st.sessions.s0!.name = 'a\u{1F600}b中c\u0007d';
    const m = layoutPanel(st, 40, 40);
    const rows = cellText(renderFrame(m, 40, 6, 0).cells, 40);
    expect(rows[0]!.startsWith('a?b?c d')).toBe(true);
  });
  it('is deterministic', () => {
    const m = layoutPanel(office(3, 3), 80, 40);
    expect(renderFrame(m, 80, 18, 7)).toEqual(renderFrame(m, 80, 18, 7));
  });
  it('one chip per character in the visible rooms', () => {
    const m = layoutPanel(office(2, 2), 40, 40);
    const { chips } = renderFrame(m, 40, 12, 0);
    expect(chips.map(c => c.agentId)).toEqual(['boss', 's0-a0', 's0-a1', 'boss', 's1-a0', 's1-a1']);
    expect(chips[0]!.label).toBe('folder-s0: boss');
    expect(chips[3]!.label).toBe('folder-s1: boss');
    expect(chips[1]!.label).toBe('Explore');
  });
  it('animates: a needs-you boss blinks between frames', () => {
    const st = { sessions: { s: session('s', {}, [], 'needs_you') } };
    const m = layoutPanel(st, 40, 40);
    expect(renderFrame(m, 40, 6, 0).cells).not.toEqual(renderFrame(m, 40, 6, 2).cells);
  });
  it('draws the summary line in summary mode', () => {
    const m = layoutPanel(office(3), 20, 5);
    const rows = cellText(renderFrame(m, 20, 1, 0).cells, 20);
    expect(rows[0]).toMatch(/^3 rooms/);
  });
  it('runs a spawn animation without overflowing the room', () => {
    const prev = { sessions: { s: session('s') } };
    const next = { sessions: { s: session('s', {}, [agent('s', 'a1')]) } };
    const anims = startAnims(diffStates(prev, next), prev, next, 10);
    expect(anims).toHaveLength(1);
    const m = layoutPanel(next, 40, 40, anims);
    const a = renderFrame(m, 40, 6, 11).cells;
    const b = renderFrame(m, 40, 6, 40).cells;
    expect(a).not.toEqual(b);
  });
});

describe('spriteFor', () => {
  it('gives rectangular sprites about 7 px tall', () => {
    for (const kind of ['boss-typing', 'boss-idle', 'boss-lean', 'boss-alert', 'helper-working', 'helper-quiet', 'helper-walk'] as const) {
      const s = spriteFor(kind, 0);
      expect(s.rows.length).toBeGreaterThanOrEqual(6);
      expect(s.rows.length).toBeLessThanOrEqual(8);
      expect(new Set(s.rows.map(r => r.length)).size).toBe(1);
    }
  });
  it('the boss wears a tie, helpers do not', () => {
    expect(spriteFor('boss-typing', 0).rows.join('')).toContain('T');
    expect(spriteFor('helper-working', 0).rows.join('')).not.toContain('T');
  });
  it('typing moves the hands', () => {
    expect(spriteFor('boss-typing', 0).rows).not.toEqual(spriteFor('boss-typing', 1).rows);
  });
});

describe('chips', () => {
  it('clipLabel cuts a chip label to 18 characters with an ellipsis', () => {
    expect(clipLabel('short')).toBe('short');
    const long = clipLabel('a-very-long-agent-type-name');
    expect(long).toHaveLength(18);
    expect(long.endsWith('…')).toBe(true);
  });
  it('a long room name is clipped in its boss chip', () => {
    const st = office(1);
    st.sessions.s0!.name = 'n'.repeat(40);
    const m = layoutPanel(st, 40, 40);
    expect(renderFrame(m, 40, 6, 0).chips[0]!.label).toBe('nnnnnnnnnnn…: boss');
  });
  it('fitChips collapses what does not fit into +N', () => {
    const chips = Array.from({ length: 10 }, (_, i) => ({ label: `helper-${i}`, sessionId: 's', agentId: `a${i}` }));
    const { shown, hidden } = fitChips(chips, 40, 1);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length + hidden).toBe(10);
    expect(hidden).toBeGreaterThan(0);
  });
});

describe('detailsFor', () => {
  it('describes a helper: type, task, status, tokens, cost estimate, running time, last activity', () => {
    const st = {
      sessions: {
        s: session('s', {}, [
          agent('s', 'a1', 'Explore', 'working', {
            task: 'find the bug',
            startedAt: 10_000,
            stats: stats({ model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 2000, cacheRead: 3000, cacheWrite: 4000, contextTokens: 9500, lastActivity: 60_000 }),
          }),
        ]),
      },
    };
    const d = detailsFor(st, { sessionId: 's', agentId: 'a1' }, 70_000);
    expect(d).not.toBeNull();
    const text = [d!.title, ...d!.lines].join('\n');
    expect(d!.title).toContain('Explore');
    expect(text).toContain('find the bug');
    expect(text).toContain('working');
    expect(text).toContain('memory now: 9.5k tokens · written: 2.0k');
    expect(text).toContain('in 1.0k');
    expect(text).toContain('out 2.0k');
    expect(text).toContain('cache 7.0k');
    expect(text).toMatch(/~\$0\.077 \(estimate\)/);
    expect(text).toContain('1m 00s');
    expect(text).toContain('10s ago');
  });
  it('describes the boss and answers null for an id that left', () => {
    const st = { sessions: { s: session('s', { name: 'proj' }, [], 'waiting_on_team') } };
    const d = detailsFor(st, { sessionId: 's', agentId: 'boss' }, 2000);
    expect(d!.title).toContain('boss');
    expect(d!.lines.join('\n')).toContain('waiting on team');
    expect(detailsFor(st, { sessionId: 's', agentId: 'zz' }, 0)).toBeNull();
  });
  it('shows a dash for running time when the start is unknown', () => {
    const st = { sessions: { s: session('s', {}, [agent('s', 'a1', 'Explore', 'working', { startedAt: 0 })]) } };
    st.sessions.s.boss.startedAt = 0;
    expect(detailsFor(st, { sessionId: 's', agentId: 'a1' }, 99_000)!.lines).toContain('running: —');
    expect(detailsFor(st, { sessionId: 's', agentId: 'boss' }, 99_000)!.lines).toContain('running: —');
  });
});

describe('parseSnapshot', () => {
  it('keeps a well-formed body and drops malformed sessions and agents', () => {
    const good = session('s', {}, [agent('s', 'a1')]);
    const body = { version: '0.1.0', seq: 4, state: { sessions: { s: good, bad: { id: 3 }, t: { ...session('t'), agents: { x: { nope: 1 } } } } } };
    const snap = parseSnapshot(body);
    expect(snap?.seq).toBe(4);
    expect(Object.keys(snap!.state.sessions).sort()).toEqual(['s', 't']);
    expect(Object.keys(snap!.state.sessions.t!.agents)).toEqual([]);
    expect(snap!.state.sessions.s!.agents.a1!.type).toBe('Explore');
  });
  it('carries a tracker identity from version and startedAt', () => {
    const a = parseSnapshot({ version: '0.1.0', startedAt: 111, seq: 2, state: { sessions: {} } });
    const b = parseSnapshot({ version: '0.1.0', startedAt: 222, seq: 2, state: { sessions: {} } });
    const c = parseSnapshot({ version: '0.2.0', startedAt: 111, seq: 2, state: { sessions: {} } });
    expect(a?.tracker).toBe('0.1.0@111');
    expect(new Set([a?.tracker, b?.tracker, c?.tracker]).size).toBe(3);
    expect(parseSnapshot({ seq: 2, state: { sessions: {} } })?.tracker).toBe('@0');
  });
  it('answers null for garbage', () => {
    expect(parseSnapshot('x')).toBeNull();
    expect(parseSnapshot({ seq: 1 })).toBeNull();
  });
});

describe('tables copied from src stay in step', () => {
  it('agent-type colours match looksFor', () => {
    for (const type of [...Object.keys(TYPE_COLORS), 'some-custom-type', 'Explore']) {
      expect('#' + colorFor(type).toString(16).padStart(6, '0')).toBe(looksFor(type).color);
    }
  });
  it('prices match src/core/pricing', () => {
    expect(PRICES).toEqual(Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, [m.inputPerM, m.outputPerM, m.cacheReadPerM, m.cacheWritePerM]])));
  });
});
