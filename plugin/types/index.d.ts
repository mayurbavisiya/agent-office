// The /office mod's $.state contract: one line of tracker status the pane draws.
export type AgentOfficeStatus = string

declare module 'claude-code' {
  interface PluginState {
    'agent-office': { status: AgentOfficeStatus }
  }
}
