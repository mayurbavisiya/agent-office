// Pure helpers for the /office mod. No imports and no runtime APIs, so the hooks module
// (plugin/hooks/register.tsx) and vitest (tests/officeMod.test.ts) both load this file as is.

export type OfficeConfig = { port: number; token: string }
export type Probe = 'ours' | 'foreign' | 'down'
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

/** What answered `GET /state`: our tracker, something else on the port, or nothing. */
export function classifyProbe(res: ProbeResponse): Probe {
  if (res === 'refused') return 'down'
  if (res.status === 200 && isRecord(res.json) && typeof res.json.version === 'string' && 'state' in res.json) {
    return 'ours'
  }
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
  noProcess: 'Run /office once in terminal Claude, or open the Agent Office app.',
  stopped: 'Stopped the office tracker.',
  appRuns: 'The office tracker is run by the Agent Office app — quit it from the menu bar.',
  noneRunning: 'No office tracker is running.',
} as const
