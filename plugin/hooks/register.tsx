// The Agent Office mod: the /office command (start or reuse the tracker, open the panel) and
// /office stop. Every $ call is wrapped: a failure becomes one quiet line, never a thrown hook.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { MESSAGES, classifyProbe, formatReply, parseConfig } from '../mod/office'
import type { OfficeConfig, Probe } from '../mod/office'
import type { AgentOfficeStatus } from '../types'

type Engine = EngineInterface
type StateInfo = { version: string; startedBy?: string }
type ProbeResult = { kind: Probe; info?: StateInfo }

const PANE = 'agent-office'
const TITLE = 'Agent Office'
const APP = '/Applications/Agent Office.app'
/** how long one GET /state may take before the port counts as down */
const PROBE_MS = 1500
/** after a launch or a shutdown: up to 12 polls 250 ms apart, about 3 s */
const POLL_MS = 250
const POLLS = 12

const status = atom(
  { plugin: 'agent-office', key: 'status' } as const,
  'Run /office to start the tracker.' as AgentOfficeStatus,
)

const short = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0]?.slice(0, 200) ?? ''
/** what the model reads of a reply: everything but the token */
const redact = (text: string): string => text.replace(/token=[^\s]+/g, 'token=<hidden>')

async function officeDir($: Engine): Promise<string> {
  const dir = await $.env.get('AGENT_OFFICE_DIR').catch(() => undefined)
  if (dir) return dir
  const home = await $.env.get('HOME').catch(() => undefined)
  return `${home ?? ''}/.agent-office`
}

async function readConfig($: Engine, path: string): Promise<OfficeConfig | null> {
  return $.fs.read(path).then(
    text => (typeof text === 'string' ? parseConfig(text) : null),
    () => null,
  )
}

async function pluginVersion($: Engine): Promise<string | undefined> {
  try {
    const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)
    const v: unknown = typeof text === 'string' ? JSON.parse(text) : undefined
    return typeof v === 'object' && v !== null && typeof (v as StateInfo).version === 'string'
      ? (v as StateInfo).version
      : undefined
  } catch {
    return undefined
  }
}

/** Resolves after `ms`, or never when the clock is not available (so a race is decided by the other side). */
function after($: Engine, ms: number): Promise<'timeout'> {
  return new Promise(resolve => {
    $.clock.sleep(ms).then(
      () => resolve('timeout'),
      () => undefined,
    )
  })
}

async function probe($: Engine, cfg: OfficeConfig): Promise<ProbeResult> {
  const asked = $.http
    .fetch(`http://127.0.0.1:${cfg.port}/state`, { headers: { 'X-Agent-Office-Token': cfg.token } })
    .catch(() => 'refused' as const)
  const got = await Promise.race([asked, after($, PROBE_MS)])
  if (got === 'refused' || got === 'timeout') return { kind: 'down' }
  let json: unknown
  try {
    json = JSON.parse(got.text)
  } catch {
    json = undefined
  }
  const kind = classifyProbe({ status: got.status, json })
  return kind === 'ours' ? { kind, info: json as StateInfo } : { kind }
}

/** POST /shutdown; the HTTP status, or 0 when nothing answered. */
async function shutdown($: Engine, cfg: OfficeConfig): Promise<number> {
  return $.http
    .fetch(`http://127.0.0.1:${cfg.port}/shutdown`, {
      method: 'POST',
      headers: { 'X-Agent-Office-Token': cfg.token },
    })
    .then(
      r => r.status,
      () => 0,
    )
}

/** Calls `check` until it answers, at most POLLS times, POLL_MS apart. */
async function poll<T>($: Engine, check: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < POLLS; i++) {
    const v = await check().catch(() => undefined)
    if (v !== undefined) return v
    if (i < POLLS - 1) {
      const slept = await $.clock.sleep(POLL_MS).then(
        () => true,
        () => false,
      )
      if (!slept) break
    }
  }
  return undefined
}

type Launch = 'ok' | 'no-node' | 'no-process' | { exitCode: number }

async function launch($: Engine): Promise<Launch> {
  try {
    const root = $.plugin.root
    const r = await $.process.run(['/bin/sh', `${root}/scripts/launch-tracker.sh`, root], { timeoutMs: 10_000 })
    if (r.exitCode === 3) return 'no-node'
    return r.exitCode === 0 ? 'ok' : { exitCode: r.exitCode }
  } catch {
    // $.process is CLI only: a desktop, mobile or SDK host refuses it
    return 'no-process'
  }
}

async function setStatus($: Engine, text: string): Promise<void> {
  await update($, status, () => text).catch(() => undefined)
}

async function openOffice($: Engine): Promise<string> {
  const dir = await officeDir($)
  const cfgPath = `${dir}/config.json`
  const appInstalled = await $.fs.stat(APP).then(
    () => true,
    () => false,
  )

  let cfg = await readConfig($, cfgPath)
  let found: ProbeResult = cfg ? await probe($, cfg) : { kind: 'down' }
  if (found.kind === 'foreign' && cfg) return MESSAGES.foreignPort(cfg.port)

  // a tracker of an older (or newer) plugin: restart it, unless the app runs it
  if (cfg && found.kind === 'ours' && found.info?.startedBy === 'plugin') {
    const want = await pluginVersion($)
    if (want !== undefined && found.info.version !== want) {
      const sent = await shutdown($, cfg)
      if (sent >= 200 && sent < 300) {
        const live = cfg
        await poll($, async () => ((await probe($, live)).kind === 'ours' ? undefined : true))
        found = { kind: 'down' }
      }
    }
  }

  let started = false
  if (found.kind === 'down') {
    const launched = await launch($)
    if (launched === 'no-process') return MESSAGES.noProcess
    if (launched === 'no-node') return MESSAGES.nodeMissing
    if (launched !== 'ok') {
      return `Couldn't start the office tracker (exit ${launched.exitCode}). See ${dir}/tracker.log.`
    }
    started = true
    const up = await poll($, async () => {
      const c = await readConfig($, cfgPath)
      if (!c) return undefined
      const p = await probe($, c)
      return p.kind === 'down' ? undefined : { cfg: c, found: p }
    })
    if (!up) return `The office tracker didn't answer within 3 seconds. See ${dir}/tracker.log.`
    if (up.found.kind === 'foreign') return MESSAGES.foreignPort(up.cfg.port)
    cfg = up.cfg
    found = up.found
  }
  if (!cfg) return MESSAGES.noneRunning

  await setStatus($, `Tracker running on port ${cfg.port} (started by ${found.info?.startedBy ?? 'unknown'}).`)
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  return formatReply({ port: cfg.port, token: cfg.token, started, appInstalled })
}

async function stopOffice($: Engine): Promise<string> {
  const cfg = await readConfig($, `${await officeDir($)}/config.json`)
  if (!cfg) return MESSAGES.noneRunning
  const found = await probe($, cfg)
  if (found.kind !== 'ours') return MESSAGES.noneRunning
  if (found.info?.startedBy !== 'plugin') return MESSAGES.appRuns
  const sent = await shutdown($, cfg)
  if (sent === 409) return MESSAGES.appRuns
  if (sent >= 200 && sent < 300) {
    await setStatus($, 'Tracker stopped. Run /office to start it again.')
    return MESSAGES.stopped
  }
  return sent === 0 ? MESSAGES.noneRunning : `Couldn't stop the office tracker (HTTP ${sent}).`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'office',
        description: 'Open the Agent Office panel (starts the tracker if needed)',
        argumentHint: '[stop]',
      })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    let text: string
    try {
      const arg = e.args.trim().toLowerCase()
      if (arg === 'stop') text = await stopOffice($)
      else if (arg === '') text = await openOffice($)
      else text = 'Usage: /office to open the panel, /office stop to stop the tracker.'
    } catch (err) {
      text = `Agent Office: ${short(err)}`
    }
    // the reply carries the token for the person; the model reads it without
    return { text, context: [redact(text)], isTextDisplayOnly: true }
  })

  // Placeholder until the pixel panel lands (Task 3).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const line = await read($, status)
    return (
      <Box flexDirection="column">
        <Text bold>Agent Office</Text>
        <Text dimColor>{line}</Text>
      </Box>
    )
  })
}
