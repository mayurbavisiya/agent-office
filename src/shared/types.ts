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
  tools: Record<string, number>;
  files: string[];
  /** max 20 */
  recent: string[];
  lastActivity: number;
  /** Recent API message ids already counted (bounded, newest last); dedupes usage across log lines (see core/logParser.ts). */
  seenMessageIds?: string[];
};

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
  branch?: string;
  status: 'active' | 'ended';
  boss: { status: BossStatus; startedAt: number; stats: AgentStats };
  agents: Record<string, Agent>;
  lastActivity: number;
};

export type OfficeState = { sessions: Record<string, Session> };

export type OfficeEvent =
  | { kind: 'spawned'; sessionId: string; agentId: string }
  | { kind: 'handoff'; sessionId: string; agentId: string; toId: string | 'boss' }
  | { kind: 'left'; sessionId: string; agentId: string }
  | { kind: 'shift_change'; fromSessionId: string; toSessionId: string }
  | { kind: 'session_started' | 'session_ended'; sessionId: string };

export type ServerMessage =
  | { type: 'snapshot'; state: OfficeState }
  | { type: 'events'; events: OfficeEvent[]; state: OfficeState };
