// Info panel: pure model + formatters (tested under node) and the DOM card. Browser-safe imports only.
// Every untrusted string reaches the DOM through textContent, never innerHTML.
import type { Agent, AgentStats, AgentStatus, BossStatus, OfficeState, Session } from '../shared/types.js';
import { contextSize, estimateCost } from '../core/pricing.js';
import { liveTokens, looksFor } from './looks.js';
import { roomTitle } from './layout.js';

const DASH = '—';

export function formatTokens(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return DASH;
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

export function formatCost(c: number | null): string {
  return c === null || !Number.isFinite(c) ? DASH : `~$${c.toFixed(3)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** True once anything has been observed for this agent: a model name or any tokens. */
export function hasUsage(st: AgentStats): boolean {
  return st.model !== undefined || !!(st.inputTokens || st.outputTokens || st.cacheRead || st.cacheWrite);
}

export type PanelTarget = { session: Session; agentId: string | 'boss' };

export type PanelModel = {
  name: string;
  type: string;
  task: string;
  color: string;
  statusLabel: string;
  statusColor: string;
  model: string;
  tokens: { input: string; output: string; cacheRead: string; cacheWrite: string };
  /** tokens in the agent's memory now (the headline number) */
  memory: string;
  /** e.g. "in memory now · of 1M" */
  memoryLabel: string;
  duration: string;
  startedAt: string;
  cost: string;
  /** 0..100, undefined when unknown */
  contextPct?: number;
  contextLabel: string;
  tools: Array<{ name: string; count: number }>;
  toolTotal: number;
  files: string[];
  recent: string[];
  /** boss only */
  team?: { spawned: number; done: number; stuck: number };
};

const AGENT_STATUS: Record<AgentStatus, [string, string]> = {
  working: ['Working', '#10b981'],
  quiet: ['Maybe stuck', '#dc2626'],
  handing_off: ['Handing off', '#f97316'],
  gone: ['Left', '#64748b'],
  spawning: ['Spawning', '#3b82f6'],
};
const BOSS_STATUS: Record<BossStatus, [string, string]> = {
  working: ['Working', '#8b5cf6'],
  delegating: ['Delegating', '#8b5cf6'],
  waiting_on_team: ['Waiting on team', '#3b82f6'],
  idle: ['Idle', '#64748b'],
  needs_you: ['Needs you', '#dc2626'],
};

/** Everything the panel shows for one agent, or null if the agent (or session) is not in the state. */
export function panelModel(target: PanelTarget, now: number): PanelModel | null {
  const { session, agentId } = target;
  if (!session) return null;
  const isBoss = agentId === 'boss';
  const agent: Agent | undefined = isBoss ? undefined : session.agents[agentId];
  if (!isBoss && !agent) return null;
  const st: AgentStats = isBoss ? session.boss.stats : agent!.stats;
  const startedAt = isBoss ? session.boss.startedAt : agent!.startedAt;
  const endedAt = isBoss ? (session.status === 'ended' ? session.lastActivity : undefined) : agent!.endedAt;

  let statusLabel: string;
  let statusColor: string;
  if (isBoss) [statusLabel, statusColor] = BOSS_STATUS[session.boss.status] ?? [String(session.boss.status), '#64748b'];
  else {
    [statusLabel, statusColor] = AGENT_STATUS[agent!.status] ?? [String(agent!.status), '#64748b'];
    if (agent!.status === 'quiet') statusLabel += ` · ${formatDuration(now - st.lastActivity)} quiet`;
  }

  const noUsage = !hasUsage(st);
  const tok = (n: number) => (noUsage ? DASH : formatTokens(n));
  const size = contextSize(st.model);
  const memoryLabel = size ? `in memory now · of ${formatTokens(size)}` : 'in memory now';
  const pct = typeof st.contextFill === 'number' && Number.isFinite(st.contextFill) ? Math.round(st.contextFill * 100) : undefined;
  const tools = Object.entries(st.tools)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  const type = isBoss ? 'main' : agent!.type;
  const agents = Object.values(session.agents);
  // finished subagents may be absent from the store (discovered sessions): the boss's Agent tool count covers them
  const spawned = Math.max(agents.length, session.boss.stats.tools.Agent ?? 0);
  const running = agents.filter((a) => a.status !== 'gone' && a.status !== 'handing_off' && a.status !== 'quiet').length;
  const stuck = agents.filter((a) => a.status === 'quiet').length;

  return {
    name: isBoss ? 'Main agent' : (agent!.name ?? agent!.type),
    type,
    task: isBoss ? [roomTitle(session), session.subLabel].filter(Boolean).join(' · ') : (agent!.task ?? ''),
    color: looksFor(type).color,
    statusLabel,
    statusColor,
    model: st.model ?? DASH,
    tokens: { input: tok(st.inputTokens), output: tok(st.outputTokens), cacheRead: tok(st.cacheRead), cacheWrite: tok(st.cacheWrite) },
    memory: noUsage ? DASH : formatTokens(liveTokens(st)),
    memoryLabel,
    duration: formatDuration((endedAt ?? now) - startedAt),
    startedAt: clock(startedAt),
    cost: noUsage ? DASH : formatCost(estimateCost(st)),
    contextPct: pct,
    contextLabel: pct === undefined ? DASH : `${pct}%`,
    tools,
    toolTotal: tools.reduce((n, t) => n + t.count, 0),
    files: st.files,
    recent: st.recent,
    team: isBoss ? { spawned, done: Math.max(0, spawned - running - stuck), stuck } : undefined,
  };
}

// ---------- DOM ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: Element): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export type Selection = { sessionId: string; agentId: string };

/** The floating card. refresh() is cheap enough to call once a second. */
export class InfoPanel {
  private sel: Selection | null = null;
  private last: PanelModel | null = null;
  /** called after open/close so the host can re-fit the zoom */
  onChange: () => void = () => {};

  constructor(private readonly root: HTMLElement) {}

  get selection(): Selection | null {
    return this.sel;
  }
  get isOpen(): boolean {
    return this.sel !== null;
  }

  open(sel: Selection, state: OfficeState, now = Date.now()): void {
    const changed = !this.sel || this.sel.sessionId !== sel.sessionId || this.sel.agentId !== sel.agentId;
    this.sel = sel;
    if (changed) {
      this.last = null;
      this.root.scrollTop = 0;
    }
    this.root.hidden = false;
    this.refresh(state, now);
    this.onChange();
  }

  close(): void {
    if (!this.sel) return;
    this.sel = null;
    this.last = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onChange();
  }

  refresh(state: OfficeState, now = Date.now()): void {
    if (!this.sel) return;
    const session = state.sessions[this.sel.sessionId];
    const m = session ? panelModel({ session, agentId: this.sel.agentId }, now) : null;
    if (m) this.last = m;
    if (!this.last) {
      // never saw this agent at all
      this.draw(null, true);
      return;
    }
    this.draw(this.last, !m);
  }

  private draw(m: PanelModel | null, left: boolean): void {
    const root = this.root;
    const scrolls = Array.from(root.querySelectorAll('.log')).map((e) => e.scrollTop);
    const billingOpen = root.querySelector<HTMLDetailsElement>('details.billing')?.open ?? false;
    const top = root.scrollTop;
    root.replaceChildren();

    const close = el('button', 'p-close', '×', root);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close panel');
    close.dataset.action = 'close';

    if (!m) {
      el('h3', undefined, 'This agent has left the office', root);
      return;
    }
    const h = el('h3', undefined, undefined, root);
    const dot = el('span', undefined, '●', h);
    dot.style.color = m.color;
    h.append(' ' + m.name);
    if (m.task) el('div', 'sub', m.task, root);
    if (left) el('div', 'p-left', 'This agent has left the office. Showing last-known numbers.', root);

    const chips = el('div', undefined, undefined, root);
    const status = el('span', 'chip', left ? 'Left' : m.statusLabel, chips);
    status.style.background = (left ? '#64748b' : m.statusColor) + '22';
    status.style.color = left ? '#64748b' : m.statusColor;
    el('span', 'chip chip-model', m.model, chips);
    if (m.type !== m.name) el('span', 'chip chip-model', m.type, chips);

    const grid = el('div', 'grid', undefined, root);
    const stat = (v: string, label: string) => {
      const s = el('div', 'stat', undefined, grid);
      el('b', undefined, v, s);
      el('span', undefined, label, s);
    };
    stat(m.memory, m.memoryLabel);
    stat(m.tokens.output, 'written by the agent');
    stat(m.duration, `running time · since ${m.startedAt}`);
    stat(m.cost, 'estimated cost');

    el('h4', undefined, `Memory used · ${m.contextLabel}`, root);
    const bar = el('div', 'bar', undefined, root);
    const fill = el('i', undefined, undefined, bar);
    fill.style.width = m.contextPct === undefined ? '0%' : `${Math.max(0, Math.min(100, m.contextPct))}%`;

    const billing = el('details', 'billing', undefined, root);
    billing.open = billingOpen;
    el('summary', undefined, 'Billing details', billing);
    el('div', 'bill-row', `input ${m.tokens.input} · output ${m.tokens.output} · cache read ${m.tokens.cacheRead} · cache write ${m.tokens.cacheWrite}`, billing);
    el('div', 'bill-note', 'Totals for the whole run. Each step re-reads the conversation from the cache, so cache read grows much faster than memory.', billing);

    el('h4', undefined, `Tool calls (${m.toolTotal})`, root);
    const tools = el('div', 'tools', undefined, root);
    if (!m.tools.length) el('span', undefined, DASH, tools);
    for (const t of m.tools) el('span', undefined, `${t.name} × ${t.count}`, tools);

    if (m.team) {
      el('h4', undefined, 'Team', root);
      el('div', undefined, `${m.team.spawned} subagents spawned · ${m.team.done} done · ${m.team.stuck} stuck`, root);
    }

    const list = (title: string, items: string[]) => {
      el('h4', undefined, title, root);
      const log = el('div', 'log', undefined, root);
      if (!items.length) el('div', undefined, DASH, log);
      for (const it of items) el('div', undefined, it, log);
    };
    list('Files touched', m.files);
    list('Recent activity', m.recent);
    root.scrollTop = top;
    root.querySelectorAll('.log').forEach((e, i) => {
      if (scrolls[i] !== undefined) e.scrollTop = scrolls[i];
    });
  }
}
