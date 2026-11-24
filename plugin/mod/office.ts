// Pure helpers for the /office mod. No imports and no runtime APIs, so the hooks module
// (plugin/hooks/register.tsx) and vitest (tests/officeMod.test.ts) both load this file as is.

export type OfficeConfig = { port: number; token: string }
export type Probe = 'ours' | 'foreign' | 'down' | 'badToken' | 'older'
export type ProbeResponse = { status: number; json?: unknown } | 'refused'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `~/.agent-office/config.json` text to `{ port, token }`, or null when it is not one. */
export function parseConfig(text: string): OfficeConfig | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(v)) return null
  const { port, token } = v
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof token !== 'string' || token === '') return null
  return { port, token }
}

/**
 * Whether a `GET /state` answer calls for the second check, `POST /event` with body `{}`: only an
 * answer that is neither a 200 nor a 401 (an Agent Office app from before `/state` answers 404).
 */
export function needsEventCheck(res: ProbeResponse): boolean {
  return res !== 'refused' && res.status !== 200 && res.status !== 401
}

/**
 * What answered `GET /state`: our tracker, one with another token (401), an older Agent Office app
 * (no `/state`, but `POST /event {}` with our token answers 400, the "not a hook event" reply),
 * something else on the port, or nothing. `event` is that second check's status, when it ran.
 */
export function classifyProbe(res: ProbeResponse, event?: number | 'refused'): Probe {
  if (res === 'refused') return 'down'
  if (res.status === 200 && isRecord(res.json) && typeof res.json.version === 'string' && 'state' in res.json) {
    return 'ours'
  }
  if (res.status === 401) return 'badToken'
  if (res.status !== 200 && event === 400) return 'older'
  return 'foreign'
}

export function officeUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
}

/** The reply `/office` prints once the panel is open. */
export function formatReply(o: { port: number; token: string; started: boolean; appInstalled: boolean }): string {
  const lines = [
    o.started ? 'Started the office tracker. The Agent Office panel is open.' : 'The Agent Office panel is open.',
    `Full office in your browser: ${officeUrl(o.port, o.token)}`,
  ]
  if (o.appInstalled) lines.push('Or open the Agent Office desktop app instead.')
  return lines.join('\n')
}

export const MESSAGES = {
  nodeMissing: 'Agent Office needs Node.js 20 or newer — install it from nodejs.org, then run /office again.',
  foreignPort: (port: number) =>
    `Port ${port} is in use by something else. Change "port" in ~/.agent-office/config.json and run /office again.`,
  older: (port: number) =>
    `An older Agent Office app is running on port ${port}. Rebuild and restart it (or quit it) to use /office.`,
  badToken: (port: number) =>
    `The office tracker on port ${port} uses a different token. Restart it, or check ~/.agent-office/config.json.`,
  noProcess: 'Run /office once in terminal Claude, or open the Agent Office app.',
  launcherFailed: (dir: string) => `Couldn't start the office tracker (the launcher failed). See ${dir}/tracker.log.`,
  stopped: 'Stopped the office tracker.',
  appRuns: 'The office tracker is run by the Agent Office app — quit it from the menu bar.',
  noneRunning: 'No office tracker is running.',
  restartFailed: "Couldn't restart the office tracker for the update; using the running one.",
} as const
