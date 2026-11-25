// The /office mod's $.state contract: what the pane draws from. Self-contained (the validator takes
// no imports here); the snapshot types mirror plugin/mod/pixels.ts (PxState, Snapshot).

export type AgentOfficeStats = {
  model?: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  lastActivity: number
}
export type AgentOfficeAgent = {
  id: string
  type: string
  name?: string
  task?: string
  status: 'spawning' | 'working' | 'quiet' | 'handing_off' | 'gone'
  waitingOnYou?: true
  tool?: { name: string; since: number }
  looping?: { tool: string; count: number }
  startedAt: number
  endedAt?: number
  stats: AgentOfficeStats
}
export type AgentOfficeSession = {
  id: string
  label: string
  name?: string
  status: 'active' | 'ended'
  boss: { status: 'working' | 'delegating' | 'waiting_on_team' | 'idle' | 'needs_you'; startedAt: number; stats: AgentOfficeStats }
  agents: Record<string, AgentOfficeAgent>
  lastActivity: number
  floorSince?: number
}

/** one line of tracker status, shown before the first poll answers */
export type AgentOfficeStatus = string
/** the last `/state` the poll read, slimmed to what the pane draws */
export type AgentOfficeSnapshot = { seq: number; tracker?: string; state: { sessions: Record<string, AgentOfficeSession> }; today?: { cost: number; tokens: number } } | null
/** whether the last poll reached the tracker */
export type AgentOfficeReach = 'unknown' | 'up' | 'down'
/** the character whose chip was pressed: its details replace the rooms until "close" */
export type AgentOfficeSelected = { sessionId: string; agentId: string } | null

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      status: AgentOfficeStatus
      snapshot: Shaped<AgentOfficeSnapshot>
      reach: AgentOfficeReach
      selected: AgentOfficeSelected
    }
  }
}
