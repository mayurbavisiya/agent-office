/**
 * Hook payload as delivered by Claude Code (field names verified in docs/hook-notes.md).
 * Explicit optional fields beyond the common ones:
 * - tool_response: PostToolUse result; for the Agent tool it holds `agentId` (child agent_id).
 * - background_tasks: on Stop/SubagentStop, lists still-running background subagents.
 * - last_assistant_message: on Stop.
 * - tool_input for the Agent tool: description, prompt, subagent_type, run_in_background, name.
 */
export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  source?: string;
  reason?: string;
  tool_name?: string;
  tool_input?: {
    description?: string;
    prompt?: string;
    subagent_type?: string;
    run_in_background?: boolean;
    name?: string;
    [k: string]: unknown;
  };
  tool_response?: { agentId?: string; status?: string; [k: string]: unknown } | unknown;
  tool_use_id?: string;
  agent_transcript_path?: string;
  notification_type?: string;
  message?: string;
  session_title?: string;
  background_tasks?: Array<{
    id: string;
    type?: string;
    status?: string;
    description?: string;
    agent_type?: string;
    [k: string]: unknown;
  }>;
  last_assistant_message?: string;
  /** Synthetic only (rescan): on SessionStart(clear), the session id this one replaced (same process). */
  replaces?: string;
  [k: string]: unknown;
};

export type AgentStats = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  /** 0..1 */
  contextFill?: number;
  /** Tokens in the agent's context after its latest API call (input + cache read + cache write + output of that call), as Claude Code reports a subagent's total. Drops after /compact. */
  contextTokens?: number;
  tools: Record<string, number>;
  files: string[];
  /** max 20 */
  recent: string[];
  lastActivity: number;
  /** Recent API message ids already counted (bounded, newest last); dedupes usage across log lines (see core/logParser.ts). */
  seenMessageIds?: string[];
};

/** The tool call an agent is in the middle of: started, not yet returned. A long one is "running", not stuck. */
export type OpenTool = { name: string; since: number };
/** The same tool call (same tool, same input) made `count` times in a row: maybe looping. */
export type Looping = { tool: string; count: number };

export type AgentStatus = 'spawning' | 'working' | 'quiet' | 'handing_off' | 'gone';
export type BossStatus = 'working' | 'delegating' | 'waiting_on_team' | 'idle' | 'needs_you';

export type Agent = {
  id: string;
  sessionId: string;
  /** null = child of boss */
  parentId: string | null;
  type: string;
  task?: string;
  /** Agent tool_input.name (named agents) or teammate name, when known */
  name?: string;
  status: AgentStatus;
  /** set while this agent is blocked on the person (its permission prompt or question is open); never counts as stuck */
  waitingOnYou?: true;
  tool?: OpenTool;
  looping?: Looping;
  startedAt: number;
  endedAt?: number;
  stats: AgentStats;
};

export type Session = {
  id: string;
  cwd: string;
  /** folder name */
  label: string;
  /** title or short id when same folder */
  subLabel?: string;
  /** session name from Claude Code's session registry (shown on the room sign instead of label) */
  name?: string;
  branch?: string;
  status: 'active' | 'ended';
  boss: { status: BossStatus; startedAt: number; stats: AgentStats; tool?: OpenTool; looping?: Looping };
  agents: Record<string, Agent>;
  lastActivity: number;
  /** floor order key (ms): set when the room is created, carried over on a /clear takeover so the room keeps its slot */
  floorSince?: number;
};

export type OfficeState = { sessions: Record<string, Session> };

/** A subagent that worked on the task that just finished, back for the party. */
export type PartyGuest = { id: string; type: string; name?: string };

export type OfficeEvent =
  | { kind: 'spawned'; sessionId: string; agentId: string }
  | { kind: 'handoff'; sessionId: string; agentId: string; toId: string | 'boss' }
  | { kind: 'left'; sessionId: string; agentId: string }
  | { kind: 'shift_change'; fromSessionId: string; toSessionId: string }
  /** the whole task is done (the main agent stopped and nobody is still working): the crew comes back to celebrate */
  | { kind: 'party'; sessionId: string; crew: PartyGuest[] }
  | { kind: 'session_started' | 'session_ended'; sessionId: string };

export type ServerMessage =
  | { type: 'snapshot'; state: OfficeState }
  | { type: 'events'; events: OfficeEvent[]; state: OfficeState };
