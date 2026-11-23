import type { Agent, AgentStatus, BossStatus, HookEvent, OfficeEvent, OfficeState, Session } from '../shared/types.js';
import { applyDelta, emptyStats, type LogDelta } from './logParser.js';

/**
 * OfficeStore: hook events + log deltas in, OfficeState + OfficeEvents out.
 * Rules follow the spec ("Session and agent states", "Claude's calls") and docs/hook-notes.md.
 * Each entity's status changes live in one function: transitionSession, transitionAgent, transitionBoss.
 * Never throws: every public entry point is guarded.
 */

/** handing_off → gone after the walk-to-boss animation */
export const HANDOFF_MS = 6_000;
/** gone agents / ended sessions stay in snapshots this long, then are pruned */
export const LINGER_MS = 60_000;
/** spawning → working without activity after this long */
export const SPAWN_MS = 2_000;
const MAX_PENDING = 100;
const TAKEOVER_SOURCES = new Set(['clear', 'resume', 'compact']);
const RUNNING: ReadonlySet<AgentStatus> = new Set(['spawning', 'working', 'quiet']);
/** idle_prompt is deliberately absent: it fires ~60 s after Stop, which is the spec's idle (sleeping) state. */
const NEEDS_YOU_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);
/** how many replaced (taken-over) session ids are remembered to drop their late events */
const MAX_REPLACED = 200;

/** A PreToolUse(Agent) waiting to be matched to the SubagentStart it caused (hook-notes §2/§3). */
type PendingSpawn = {
  toolUseId: string;
  /** agent_id of the caller; null = main agent */
  parentId: string | null;
  description?: string;
  subagentType?: string;
  name?: string;
  claimedBy?: string;
};

/** Store-private per-session state (kept out of the shared Session type / snapshots). */
type SessionMeta = {
  /** main agent's own phase; BossStatus is derived from it + needsYou + running agents */
  main: 'working' | 'stopped';
  needsYou: boolean;
  title?: string;
  endedAt?: number;
  pending: PendingSpawn[];
  /** agents pruned from state; late events for them are ignored rather than recreating them */
  retired: Set<string>;
};

type TeammateLink = { leadSessionId: string; agentId: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function labelFor(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

/**
 * Teammate → lead link rule. UNVERIFIED (hook-notes §4 and "Not captured" #3); Task 13 adjusts it.
 * A session is a teammate of a lead when one of its events names a lead session id that is a live
 * session in the same cwd (spec: "same project folder and a lead/teammate signal from hooks").
 * Named in-session agents (Agent tool with `name`) are NOT teammates: they are ordinary children.
 */
export function findLeadSession(e: HookEvent, sessions: Record<string, Session>): string | null {
  const cwd = str(e.cwd);
  if (!cwd) return null;
  for (const k of ['lead_session_id', 'leader_session_id', 'parent_session_id']) {
    const id = str(e[k]);
    if (!id || id === e.session_id) continue;
    const lead = sessions[id];
    if (lead && lead.status === 'active' && lead.cwd === cwd) return id;
  }
  return null;
}

/**
 * Permission prompts and elicitation/input dialogs only (controller ruling); everything else, including
 * idle_prompt, is ignored. The "permission" text fallback applies only when notification_type is absent.
 */
function isNeedsYouNotification(e: HookEvent): boolean {
  const t = str(e.notification_type);
  if (t) return NEEDS_YOU_TYPES.has(t);
  return (str(e.message)?.toLowerCase() ?? '').includes('permission');
}

// ---------------------------------------------------------------- transitions

type SessionInput = 'revive' | 'end' | 'tick';
type SessionResult = 'session_started' | 'session_ended' | 'prune' | null;

function transitionSession(s: Session, m: SessionMeta, input: SessionInput, now: number, endedMs: number): SessionResult {
  switch (input) {
    case 'revive':
      if (s.status !== 'ended') return null;
      s.status = 'active';
      m.endedAt = undefined;
      transitionBoss(s, m, 'reset');
      return 'session_started';
    case 'end':
      if (s.status === 'ended') return null;
      s.status = 'ended';
      m.endedAt = now;
      transitionBoss(s, m, 'reset');
      return 'session_ended';
    case 'tick':
      if (s.status === 'active' && now - s.lastActivity >= endedMs) return transitionSession(s, m, 'end', now, endedMs);
      if (s.status === 'ended' && now - (m.endedAt ?? now) >= LINGER_MS) return 'prune';
      return null;
  }
}

type AgentInput = 'activity' | 'stop' | 'tick';
type AgentResult = 'changed' | 'handoff' | 'left' | 'prune' | null;

function transitionAgent(a: Agent, input: AgentInput, now: number, stuckMs: number): AgentResult {
  const set = (st: AgentStatus): AgentResult => {
    if (a.status === st) return null;
    a.status = st;
    return 'changed';
  };
  switch (input) {
    case 'activity':
      // late events after a stop do not bring the agent back
      if (a.status === 'handing_off' || a.status === 'gone') return null;
      a.stats.lastActivity = now;
      return set('working');
    case 'stop':
      if (a.status === 'handing_off' || a.status === 'gone') return null;
      a.status = 'handing_off';
      a.endedAt = now;
      return 'handoff';
    case 'tick': {
      const ended = a.endedAt ?? now;
      if (a.status === 'gone') return now - ended >= HANDOFF_MS + LINGER_MS ? 'prune' : null;
      if (a.status === 'handing_off') {
        if (now - ended < HANDOFF_MS) return null;
        a.status = 'gone';
        return 'left';
      }
      const idle = now - a.stats.lastActivity;
      if ((a.status === 'spawning' || a.status === 'working') && idle >= stuckMs) return set('quiet');
      if (a.status === 'spawning' && now - a.startedAt >= SPAWN_MS) return set('working');
      return null;
    }
  }
}

type BossInput = 'human_prompt' | 'main_activity' | 'pre_tool' | 'stop' | 'needs_you' | 'reset' | 'recompute';

/** Updates the main agent's phase and derives BossStatus. Returns true if the visible status changed. */
function transitionBoss(s: Session, m: SessionMeta, input: BossInput): boolean {
  switch (input) {
    case 'human_prompt':
      m.main = 'working';
      m.needsYou = false;
      break;
    case 'main_activity':
      m.main = 'working';
      break;
    case 'pre_tool':
      m.needsYou = false;
      break;
    case 'stop':
      m.main = 'stopped';
      break;
    case 'needs_you':
      m.needsYou = true;
      break;
    case 'reset':
      m.main = 'stopped';
      m.needsYou = false;
      break;
    case 'recompute':
      break;
  }
  const running = Object.values(s.agents).some((a) => RUNNING.has(a.status));
  const next: BossStatus = m.needsYou
    ? 'needs_you'
    : m.main === 'working'
      ? running ? 'delegating' : 'working'
      : running ? 'waiting_on_team' : 'idle';
  const changed = s.boss.status !== next;
  s.boss.status = next;
  return changed;
}

// ---------------------------------------------------------------- store

export class OfficeStore {
  private readonly stuckMs: number;
  private readonly endedMs: number;
  private sessions: Record<string, Session> = {};
  private meta = new Map<string, SessionMeta>();
  private teammates = new Map<string, TeammateLink>();
  /**
   * Session ids replaced by a takeover (old id → successor), bounded to MAX_REPLACED, oldest dropped.
   * Late hook events and logs for a replaced id are DROPPED, not rerouted: they belong to the old
   * conversation (its SessionEnd/Stop/tool events would wrongly end or idle the successor's room, and
   * its tokens are not the new conversation's). Only an explicit SessionStart(source: resume) for the
   * old id brings it back, as its own session.
   */
  private replaced = new Map<string, string>();
  private listeners: Array<(events: OfficeEvent[]) => void> = [];

  constructor(opts: { stuckMs?: number; endedMs?: number } = {}) {
    this.stuckMs = opts.stuckMs ?? 180_000;
    this.endedMs = opts.endedMs ?? 1_800_000;
  }

  onChange(cb: (events: OfficeEvent[]) => void): void {
    this.listeners.push(cb);
  }

  snapshot(): OfficeState {
    return { sessions: structuredClone(this.sessions) };
  }

  applyHook(e: HookEvent, now: number): OfficeEvent[] {
    const out: OfficeEvent[] = [];
    if (!isObj(e)) return out;
    try {
      this.handleHook(e, now, out);
      this.refreshSubLabels();
    } catch {
      // never throw on input; whatever was applied before the fault stays applied
    }
    this.notify(out);
    return out;
  }

  applyLog(sessionId: string, agentId: string | null, d: LogDelta, now: number): void {
    const out: OfficeEvent[] = [];
    if (!str(sessionId) || !isObj(d) || this.replaced.has(sessionId)) return;
    try {
      const delta: LogDelta = { ...d, toolUses: Array.isArray(d.toolUses) ? d.toolUses : [] };
      let sid = sessionId;
      let aid = str(agentId) ?? null;
      const link = this.teammates.get(sid);
      if (link) {
        sid = link.leadSessionId;
        aid ??= link.agentId;
      }
      const s = this.ensureSession(sid, str(delta.cwd) ?? undefined, now, out);
      if (str(delta.gitBranch)) s.branch = delta.gitBranch;
      const m = this.meta.get(sid)!;
      if (aid) {
        const a = this.ensureAgent(s, m, aid, now, out, {});
        if (!a) return;
        a.stats = applyDelta(a.stats, delta);
        a.stats.lastActivity = now;
        transitionAgent(a, 'activity', now, this.stuckMs);
      } else {
        s.boss.stats = applyDelta(s.boss.stats, delta);
        s.boss.stats.lastActivity = now;
      }
      s.lastActivity = now;
      transitionBoss(s, m, 'recompute');
      this.refreshSubLabels();
    } catch {
      // never throw
    }
    this.notify(out);
  }

  tick(now: number): OfficeEvent[] {
    const out: OfficeEvent[] = [];
    let changed = false;
    try {
      if (!Number.isFinite(now)) return out;
      for (const s of Object.values(this.sessions)) {
        const m = this.meta.get(s.id)!;
        for (const a of Object.values(s.agents)) {
          const r = transitionAgent(a, 'tick', now, this.stuckMs);
          if (r === 'changed') changed = true;
          else if (r === 'left') out.push({ kind: 'left', sessionId: s.id, agentId: a.id });
          else if (r === 'prune') {
            delete s.agents[a.id];
            m.retired.add(a.id);
            m.pending = m.pending.filter((p) => p.claimedBy !== a.id);
            changed = true;
          }
        }
        if (transitionBoss(s, m, 'recompute')) changed = true;
        const r = transitionSession(s, m, 'tick', now, this.endedMs);
        if (r === 'session_ended') out.push({ kind: 'session_ended', sessionId: s.id });
        else if (r === 'prune') {
          this.removeSession(s.id);
          changed = true;
        }
      }
      if (out.length || changed) this.refreshSubLabels();
    } catch {
      // never throw
    }
    this.notify(out, changed);
    return out;
  }

  // ------------------------------------------------------------ internals

  private notify(events: OfficeEvent[], changed = true): void {
    if (!events.length && !changed) return;
    for (const cb of this.listeners) {
      try {
        cb(events);
      } catch {
        // a broken listener must not break the store
      }
    }
  }

  private handleHook(raw: HookEvent, now: number, out: OfficeEvent[]): void {
    let e = raw;
    let name = str(e.hook_event_name);
    const rawSid = str(e.session_id);
    if (!name || !rawSid) return;
    if (this.replaced.has(rawSid)) {
      if (name !== 'SessionStart' || e.source !== 'resume') return; // late event of a taken-over session
      this.replaced.delete(rawSid);
    }

    // Teammate sessions are routed into their lead's room as an agent.
    let link = this.teammates.get(rawSid);
    if (!link && !this.sessions[rawSid]) {
      const lead = findLeadSession(e, this.sessions);
      if (lead) {
        link = { leadSessionId: lead, agentId: rawSid };
        this.teammates.set(rawSid, link);
        const s = this.sessions[lead];
        const m = this.meta.get(lead)!;
        this.ensureAgent(s, m, rawSid, now, out, {
          status: 'spawning',
          type: str(e.agent_type) ?? 'teammate',
          name: str(e.agent_name) ?? str(e.teammate_name),
        });
      }
    }
    if (link) {
      const ownEvent = !str(e.agent_id);
      e = { ...e, session_id: link.leadSessionId, agent_id: str(e.agent_id) ?? link.agentId };
      if (ownEvent) {
        if (name === 'SessionEnd') name = 'SubagentStop';
        else if (name === 'UserPromptSubmit') name = 'AgentActivity';
        else if (name === 'SessionStart' || name === 'Stop') name = 'Touch';
      }
    }

    const sid = e.session_id;
    const cwd = str(e.cwd);
    const agentId = str(e.agent_id);

    if (name === 'SessionStart' && !this.sessions[sid] && TAKEOVER_SOURCES.has(str(e.source) ?? '')) {
      if (this.takeOver(sid, cwd, now, out)) return;
    }

    const s = this.ensureSession(sid, cwd, now, out);
    const m = this.meta.get(sid)!;
    const title = str(e.session_title);
    if (title) m.title = title;
    if (name !== 'SessionEnd') {
      if (transitionSession(s, m, 'revive', now, this.endedMs) === 'session_started') out.push({ kind: 'session_started', sessionId: sid });
    }
    s.lastActivity = now;

    switch (name) {
      case 'UserPromptSubmit': {
        // synthetic hand-back prompts (hook-notes §1) mean the main agent resumes, not a new human turn
        const synthetic = (str(e.prompt) ?? '').trimStart().startsWith('<agent-message');
        transitionBoss(s, m, synthetic ? 'main_activity' : 'human_prompt');
        break;
      }
      case 'PreToolUse':
      case 'PostToolUse': {
        const tool = str(e.tool_name);
        if (name === 'PreToolUse') transitionBoss(s, m, 'pre_tool');
        if (tool === 'SubagentHandback') break; // internal tool: not activity (hook-notes §1)
        if (agentId) this.agentActivity(s, m, agentId, e, now, out);
        else transitionBoss(s, m, 'main_activity');
        if (tool === 'Agent') {
          if (name === 'PreToolUse') this.recordPending(m, e, agentId);
          else this.linkFromPostToolUse(s, m, e, now, out);
        }
        break;
      }
      case 'AgentActivity':
        if (agentId) this.agentActivity(s, m, agentId, e, now, out);
        break;
      case 'SubagentStart':
        if (agentId) {
          const type = str(e.agent_type);
          const existing = s.agents[agentId];
          if (existing) {
            if (type && existing.type === 'unknown') existing.type = type;
          } else {
            this.ensureAgent(s, m, agentId, now, out, { status: 'spawning', type, claim: true });
          }
        }
        break;
      case 'SubagentStop':
        if (agentId) {
          const a = this.ensureAgent(s, m, agentId, now, out, { type: str(e.agent_type) });
          if (a && transitionAgent(a, 'stop', now, this.stuckMs) === 'handoff') {
            out.push({ kind: 'handoff', sessionId: sid, agentId, toId: a.parentId ?? 'boss' });
          }
        }
        break;
      case 'Stop':
        transitionBoss(s, m, 'stop');
        this.adoptBackgroundTasks(s, m, e, now, out);
        break;
      case 'Notification':
        if (isNeedsYouNotification(e)) transitionBoss(s, m, 'needs_you');
        break;
      case 'SessionEnd':
        if (transitionSession(s, m, 'end', now, this.endedMs) === 'session_ended') out.push({ kind: 'session_ended', sessionId: sid });
        break;
      default:
        break; // SessionStart (already ensured/revived), Touch, unknown events
    }
    transitionBoss(s, m, 'recompute');
  }

  private ensureSession(sid: string, cwd: string | undefined, now: number, out: OfficeEvent[]): Session {
    let s = this.sessions[sid];
    if (!s) {
      s = {
        id: sid,
        cwd: cwd ?? '',
        label: labelFor(cwd ?? ''),
        status: 'active',
        boss: { status: 'idle', startedAt: now, stats: emptyStats(now) },
        agents: {},
        lastActivity: now,
      };
      this.sessions[sid] = s;
      this.meta.set(sid, { main: 'stopped', needsYou: false, pending: [], retired: new Set() });
      out.push({ kind: 'session_started', sessionId: sid });
    } else if (cwd && !s.cwd) {
      s.cwd = cwd;
      s.label = labelFor(cwd);
    }
    return s;
  }

  private removeSession(sid: string): void {
    delete this.sessions[sid];
    this.meta.delete(sid);
    for (const [k, l] of this.teammates) if (l.leadSessionId === sid) this.teammates.delete(k);
  }

  /** clear/resume/compact SessionStart with a new id takes over an idle or just-ended room in the same cwd. */
  private takeOver(sid: string, cwd: string | undefined, now: number, out: OfficeEvent[]): boolean {
    if (!cwd) return false;
    let from: Session | undefined;
    for (const s of Object.values(this.sessions)) {
      if (s.cwd !== cwd) continue;
      if (s.status !== 'ended' && s.boss.status !== 'idle') continue;
      if (!from || s.lastActivity > from.lastActivity) from = s;
    }
    if (!from) return false;
    this.removeSession(from.id);
    this.replaced.delete(from.id);
    this.replaced.set(from.id, sid);
    if (this.replaced.size > MAX_REPLACED) this.replaced.delete(this.replaced.keys().next().value!);
    const sink: OfficeEvent[] = [];
    const s = this.ensureSession(sid, cwd, now, sink);
    s.branch = from.branch;
    out.push({ kind: 'shift_change', fromSessionId: from.id, toSessionId: sid });
    return true;
  }

  /**
   * Returns the agent, creating it on demand (emits `spawned`). Returns undefined for retired agents.
   * `claim` matches the oldest unclaimed PreToolUse(Agent), preferring one whose subagent_type matches.
   */
  private ensureAgent(
    s: Session,
    m: SessionMeta,
    id: string,
    now: number,
    out: OfficeEvent[],
    o: { status?: AgentStatus; type?: string; name?: string; task?: string; claim?: boolean; pending?: PendingSpawn },
  ): Agent | undefined {
    if (m.retired.has(id)) return undefined;
    const existing = s.agents[id];
    if (existing) return existing;
    const p = o.pending ?? (o.claim ? this.claim(m, o.type) : undefined);
    if (p) p.claimedBy = id;
    const parentId = p?.parentId && p.parentId !== id ? p.parentId : null;
    const a: Agent = {
      id,
      sessionId: s.id,
      parentId,
      type: o.type ?? p?.subagentType ?? 'unknown',
      status: o.status ?? 'working',
      startedAt: now,
      stats: emptyStats(now),
    };
    const task = o.task ?? p?.description;
    const name = o.name ?? p?.name;
    if (task) a.task = task;
    if (name) a.name = name;
    s.agents[id] = a;
    out.push({ kind: 'spawned', sessionId: s.id, agentId: id });
    return a;
  }

  private claim(m: SessionMeta, agentType: string | undefined): PendingSpawn | undefined {
    const open = m.pending.filter((p) => !p.claimedBy);
    return open.find((p) => (p.subagentType ?? 'general-purpose') === agentType) ?? open[0];
  }

  private agentActivity(s: Session, m: SessionMeta, id: string, e: HookEvent, now: number, out: OfficeEvent[]): void {
    const a = this.ensureAgent(s, m, id, now, out, { type: str(e.agent_type), claim: true });
    if (!a) return;
    transitionAgent(a, 'activity', now, this.stuckMs);
  }

  private recordPending(m: SessionMeta, e: HookEvent, callerId: string | undefined): void {
    const toolUseId = str(e.tool_use_id);
    if (!toolUseId || m.pending.some((p) => p.toolUseId === toolUseId)) return;
    const input = isObj(e.tool_input) ? e.tool_input : {};
    m.pending.push({
      toolUseId,
      parentId: callerId ?? null,
      description: str(input.description),
      subagentType: str(input.subagent_type),
      name: str(input.name),
    });
    if (m.pending.length > MAX_PENDING) m.pending = m.pending.slice(-MAX_PENDING);
  }

  /** PostToolUse(Agent).tool_response.agentId is the authoritative tool_use_id → agent link (hook-notes §2). */
  private linkFromPostToolUse(s: Session, m: SessionMeta, e: HookEvent, now: number, out: OfficeEvent[]): void {
    const resp = e.tool_response;
    const agentId = isObj(resp) ? str(resp.agentId) : undefined;
    const toolUseId = str(e.tool_use_id);
    if (!agentId || m.retired.has(agentId)) return;
    const p = toolUseId ? m.pending.find((x) => x.toolUseId === toolUseId) : undefined;
    if (!p) {
      this.ensureAgent(s, m, agentId, now, out, {});
      return;
    }
    for (const other of m.pending) if (other !== p && other.claimedBy === agentId) other.claimedBy = undefined;
    const a = s.agents[agentId] ?? this.ensureAgent(s, m, agentId, now, out, { pending: p });
    if (!a) return;
    p.claimedBy = agentId;
    a.parentId = p.parentId && p.parentId !== agentId ? p.parentId : null;
    if (p.description) a.task = p.description;
    if (p.name) a.name = p.name;
    if (p.subagentType && a.type === 'unknown') a.type = p.subagentType;
  }

  /** Stop.background_tasks: running subagents the store has not seen yet are created (hook-notes §6). */
  private adoptBackgroundTasks(s: Session, m: SessionMeta, e: HookEvent, now: number, out: OfficeEvent[]): void {
    if (!Array.isArray(e.background_tasks)) return;
    for (const t of e.background_tasks as unknown[]) {
      if (!isObj(t)) continue;
      const id = str(t.id);
      if (!id || s.agents[id] || t.status !== 'running' || (t.type !== undefined && t.type !== 'subagent')) continue;
      this.ensureAgent(s, m, id, now, out, { type: str(t.agent_type), task: str(t.description) });
    }
  }

  /** Two+ live sessions in one cwd: each gets subLabel = session title or the first 6 chars of its id. */
  private refreshSubLabels(): void {
    const byCwd = new Map<string, Session[]>();
    for (const s of Object.values(this.sessions)) {
      if (s.status !== 'active' || !s.cwd) continue;
      byCwd.set(s.cwd, [...(byCwd.get(s.cwd) ?? []), s]);
    }
    for (const s of Object.values(this.sessions)) {
      const group = s.status === 'active' && s.cwd ? byCwd.get(s.cwd) : undefined;
      if (group && group.length > 1) s.subLabel = this.meta.get(s.id)?.title ?? s.id.slice(0, 6);
      else delete s.subLabel;
    }
  }
}
