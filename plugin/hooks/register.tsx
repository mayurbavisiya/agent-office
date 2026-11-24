// The Agent Office mod: the /office command (start or reuse the tracker, open the panel),
// /office stop, and the pixel pane that polls the tracker. Every $ call is wrapped: a failure
// becomes one quiet line, never a thrown hook.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { MESSAGES, classifyProbe, formatReply, needsEventCheck, parseConfig } from '../mod/office'
import type { OfficeConfig, Probe } from '../mod/office'
import {
  chipsOf,
  clipLabel,
  detailsFor,
  diffStates,
  fitChips,
  isAnimLive,
  isMoving,
  layoutPanel,
  parseSnapshot,
  renderFrame,
  startAnims,
  textRooms,
} from '../mod/pixels'
import type { ActiveAnim, Chip, PanelModel, PxState, Snapshot } from '../mod/pixels'
import type { AgentOfficeReach, AgentOfficeSelected, AgentOfficeSnapshot, AgentOfficeStatus } from '../types'

type Engine = EngineInterface
type StateInfo = { version: string; startedBy?: string }
type ProbeResult = { kind: Probe; info?: StateInfo }

const PANE = 'agent-office'
const TITLE = 'Agent Office'
const APP = '/Applications/Agent Office.app'
/** how long one request to the tracker may take before it counts as unanswered */
const PROBE_MS = 500
/** the wait after a launch or a shutdown: polls POLL_MS apart until WAIT_MS have passed */
const WAIT_MS = 3000
const POLL_MS = 250

const status = atom(
  { plugin: 'agent-office', key: 'status' } as const,
  'Run /office to start the tracker.' as AgentOfficeStatus,
)

const snapshot = atom(
  { plugin: 'agent-office', key: 'snapshot' } as const,
  null as AgentOfficeSnapshot,
  { shape: 'snapshot-1' },
)
const reach = atom({ plugin: 'agent-office', key: 'reach' } as const, 'unknown' as AgentOfficeReach)
const selected = atom({ plugin: 'agent-office', key: 'selected' } as const, null as AgentOfficeSelected)

const NOT_RUNNING = 'office tracker not running — run /office'
const POLL_EVERY_MS = 1000
const FRAME_MS = 125
/** the pane may sit unplaced this long before the timers stop */
const UNPLACED_STOP_MS = 30_000
/** the rows the chips under the rooms may take */
const CHIP_ROWS = 2

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

const now = ($: Engine): Promise<number> => $.clock.now().catch(() => Date.now())

/**
 * Races `work` against a PROBE_MS timer. The timer's sleep is aborted once the race is decided, so
 * it does not linger, and a clock that rejects counts as the timer running out.
 */
async function bounded<T>($: Engine, work: Promise<T>): Promise<T | 'timeout'> {
  const stop = new AbortController()
  const timer = $.clock.sleep(PROBE_MS, { signal: stop.signal }).then(
    () => 'timeout' as const,
    () => 'timeout' as const,
  )
  try {
    return await Promise.race([work, timer])
  } finally {
    stop.abort()
  }
}

/**
 * POST /event with body `{}`: an Agent Office app from before `/state` answers 400 ("not a hook
 * event") once the token matches. The status, or 'refused' when nothing answered in time.
 */
async function eventCheck($: Engine, cfg: OfficeConfig): Promise<number | 'refused'> {
  const sent = $.http
    .fetch(`http://127.0.0.1:${cfg.port}/event`, {
      method: 'POST',
      headers: { 'X-Agent-Office-Token': cfg.token, 'Content-Type': 'application/json' },
      body: '{}',
    })
    .then(
      r => r.status,
      () => 'refused' as const,
    )
  const got = await bounded($, sent)
  return got === 'timeout' ? 'refused' : got
}

async function probe($: Engine, cfg: OfficeConfig): Promise<ProbeResult> {
  const asked = $.http
    .fetch(`http://127.0.0.1:${cfg.port}/state`, { headers: { 'X-Agent-Office-Token': cfg.token } })
    .catch(() => 'refused' as const)
  const got = await bounded($, asked)
  if (got === 'refused' || got === 'timeout') return { kind: 'down' }
  let json: unknown
  try {
    json = JSON.parse(got.text)
  } catch {
    json = undefined
  }
  const res = { status: got.status, json }
  const kind = classifyProbe(res, needsEventCheck(res) ? await eventCheck($, cfg) : undefined)
  return kind === 'ours' ? { kind, info: json as StateInfo } : { kind }
}

/** The reply for a port held by something that is not a usable tracker, or undefined. */
function notUsable(kind: Probe, port: number): string | undefined {
  if (kind === 'foreign') return MESSAGES.foreignPort(port)
  if (kind === 'older') return MESSAGES.older(port)
  if (kind === 'badToken') return MESSAGES.badToken(port)
  return undefined
}

async function onTerminal($: Engine): Promise<boolean> {
  const surfaces: readonly string[] = await $.session.surfaces().catch(() => [])
  return surfaces.includes('terminal')
}

/** POST /shutdown; the HTTP status, or 0 when nothing answered in time. */
async function shutdown($: Engine, cfg: OfficeConfig): Promise<number> {
  const sent = $.http
    .fetch(`http://127.0.0.1:${cfg.port}/shutdown`, {
      method: 'POST',
      headers: { 'X-Agent-Office-Token': cfg.token },
    })
    .then(
      r => r.status,
      () => 0,
    )
  const got = await bounded($, sent)
  return got === 'timeout' ? 0 : got
}

/** Calls `check` until it answers or WAIT_MS have passed, POLL_MS apart. */
async function poll<T>($: Engine, check: () => Promise<T | undefined>): Promise<T | undefined> {
  const end = (await now($)) + WAIT_MS
  for (;;) {
    const v = await check().catch(() => undefined)
    if (v !== undefined) return v
    const left = end - (await now($))
    if (left <= 0) return undefined
    const slept = await $.clock.sleep(Math.min(POLL_MS, left)).then(
      () => true,
      () => false,
    )
    if (!slept) return undefined
  }
}

type Launch = 'ok' | 'no-node' | 'no-process' | { exitCode: number }

async function launch($: Engine): Promise<Launch> {
  try {
    const root = $.plugin.root
    const r = await $.process.run(['/bin/sh', `${root}/scripts/launch-tracker.sh`, root], { timeoutMs: 10_000 })
    if (r.exitCode === 3) return 'no-node'
    return r.exitCode === 0 ? 'ok' : { exitCode: r.exitCode }
  } catch {
    // $.process is CLI only: a desktop, mobile or SDK host refuses it (on the terminal, the run failed)
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
  const refused = cfg ? notUsable(found.kind, cfg.port) : undefined
  if (refused) return refused

  // a tracker of an older (or newer) plugin: restart it, unless the app runs it
  let note: string | undefined
  if (cfg && found.kind === 'ours' && found.info?.startedBy === 'plugin') {
    const want = await pluginVersion($)
    if (want !== undefined && found.info.version !== want) {
      const live = cfg
      const sent = await shutdown($, live)
      const gone =
        sent >= 200 && sent < 300 &&
        (await poll($, async () => ((await probe($, live)).kind === 'ours' ? undefined : true))) === true
      if (gone) found = { kind: 'down' }
      else note = MESSAGES.restartFailed
    }
  }

  let started = false
  if (found.kind === 'down') {
    const launched = await launch($)
    if (launched === 'no-process') return (await onTerminal($)) ? MESSAGES.launcherFailed(dir) : MESSAGES.noProcess
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
    const upRefused = notUsable(up.found.kind, up.cfg.port)
    if (upRefused) return upRefused
    cfg = up.cfg
    found = up.found
  }
  if (!cfg) return MESSAGES.noneRunning

  await setStatus($, `Tracker running on port ${cfg.port} (started by ${found.info?.startedBy ?? 'unknown'}).`)
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  cfgCache = cfg
  ensurePoll($)
  await pollOnce($)
  const reply = formatReply({ port: cfg.port, token: cfg.token, started, appInstalled })
  return note ? `${note}\n${reply}` : reply
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

// ---- the pane: frame state lives in module variables (a reload resets them, which is fine) ----

let pollTimer: Timer | undefined
let animTimer: Timer | undefined
let inflight: Promise<void> | undefined
let cfgCache: OfficeConfig | null = null
/** `<tracker>#<seq>` of the snapshot last written: a restarted tracker counts seq from 0 again */
let lastKey: string | undefined
let lastState: PxState | null = null
let lastReach: AgentOfficeReach | undefined
let frame = 0
let anims: ActiveAnim[] = []
let isPlaced = true
let unplacedSince: number | undefined
/** the Raster as last drawn, so the frame timer can blit it without a render pass */
let mounted: { cols: number; rows: number; model: PanelModel; cells: string } | null = null

function stopTimers(): void {
  pollTimer?.cancel()
  animTimer?.cancel()
  pollTimer = undefined
  animTimer = undefined
  mounted = null
  // the next start comes from a drawing (or /office): placed until a poll says otherwise
  isPlaced = true
  unplacedSince = undefined
}

async function fetchSnapshot($: Engine, cfg: OfficeConfig): Promise<Snapshot | null> {
  const asked = $.http
    .fetch(`http://127.0.0.1:${cfg.port}/state`, { headers: { 'X-Agent-Office-Token': cfg.token } })
    .catch(() => 'refused' as const)
  const got = await bounded($, asked)
  if (got === 'refused' || got === 'timeout' || got.status !== 200) return null
  let json: unknown
  try {
    json = JSON.parse(got.text)
  } catch {
    return null
  }
  return classifyProbe({ status: got.status, json }) === 'ours' ? parseSnapshot(json) : null
}

/** Stops the timers once the pane is closed, or unplaced for a while; blits only while placed. */
async function checkPane($: Engine): Promise<void> {
  const panes = await $.ui.panes().catch(() => undefined)
  if (!panes) return
  const pane = panes.find(p => p.id === PANE)
  if (!pane) return stopTimers()
  isPlaced = pane.isPlaced
  if (isPlaced) {
    unplacedSince = undefined
    return
  }
  const t = await now($)
  unplacedSince ??= t
  if (t - unplacedSince >= UNPLACED_STOP_MS) stopTimers()
}

async function pollOnce($: Engine): Promise<void> {
  const run = async () => {
    cfgCache ??= await readConfig($, `${await officeDir($)}/config.json`)
    const snap = cfgCache ? await fetchSnapshot($, cfgCache) : null
    const r: AgentOfficeReach = snap ? 'up' : 'down'
    if (!snap) {
      cfgCache = null
      lastKey = undefined
    }
    // remembered only once written: a failed write is tried again on the next poll
    if (r !== lastReach) {
      const wrote = await update($, reach, () => r).then(() => true, () => false)
      lastReach = wrote ? r : undefined
    }
    const key = snap ? `${snap.tracker ?? ''}#${snap.seq}` : undefined
    if (snap && key !== lastKey) {
      const wrote = await update($, snapshot, () => snap).then(() => true, () => false)
      if (wrote) {
        const fresh = startAnims(diffStates(lastState, snap.state), lastState, snap.state, frame)
        anims = [...anims.filter(a => isAnimLive(a, frame)), ...fresh]
        lastKey = key
        lastState = snap.state
      } else {
        lastKey = undefined
      }
    }
    await checkPane($)
  }
  inflight ??= run()
    .catch(() => undefined)
    .finally(() => {
      inflight = undefined
    })
  return inflight
}

function tick($: Engine): void {
  frame++
  if (anims.length > 0) anims = anims.filter(a => frame - a.start < 64)
  const m = mounted
  if (!m || !isPlaced) return
  const model: PanelModel = m.model.mode === 'rooms' ? { ...m.model, anims } : m.model
  if (!isMoving(model, frame)) return
  const { cells } = renderFrame(model, m.cols, m.rows, frame)
  if (cells === m.cells) return
  m.cells = cells
  void $.ui.blit({ requestId: PANE, key: 'office', cells, columns: m.cols, rows: m.rows }).then(
    r => {
      if (r.deny && mounted === m) mounted = null
    },
    () => {
      if (mounted === m) mounted = null
    },
  )
}

/** Starts the poll (and its first read) unless it runs; true when it was started now. */
function ensurePoll($: Engine): boolean {
  if (pollTimer) return false
  pollTimer = $.clock.every(POLL_EVERY_MS, () => void pollOnce($))
  return true
}

function ensureFrames($: Engine): void {
  animTimer ??= $.clock.every(FRAME_MS, () => tick($))
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

  on('session.end', async ($, e, next) => {
    stopTimers()
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopTimers()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // never poll inside the draw (a state write there is denied): the first read runs off a timer
    if (ensurePoll($)) $.clock.after(0, () => void pollOnce($))
    const [snap, r, sel] = await Promise.all([read($, snapshot), read($, reach), read($, selected)])

    if (r === 'down') {
      mounted = null
      return <Text dimColor>{NOT_RUNNING}</Text>
    }
    if (!snap) {
      mounted = null
      return <Text dimColor>{await read($, status)}</Text>
    }

    const select = (next: AgentOfficeSelected) => () => update($, selected, () => next).then(() => undefined)
    const details = sel ? detailsFor(snap.state, sel, await now($)) : null
    if (details) {
      mounted = null
      return (
        <Box flexDirection="column">
          <Text bold>{details.title}</Text>
          {details.lines.map(line => (
            <Text>{line}</Text>
          ))}
          <Box>
            <Button key="close" label="close" onPress={select(null)} />
          </Box>
        </Box>
      )
    }

    const cols = Math.max(1, Math.min(512, e.props.bodyColumns))
    const chipRow = (chips: Chip[], width: number) => {
      const { shown, hidden } = fitChips(chips, width, CHIP_ROWS)
      return (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {shown.map(c => (
            <Button
              key={`chip:${c.sessionId}:${c.agentId}`}
              label={clipLabel(c.label)}
              onPress={select({ sessionId: c.sessionId, agentId: c.agentId })}
            />
          ))}
          {hidden > 0 && <Text dimColor>+{hidden}</Text>}
        </Box>
      )
    }

    if (e.surface !== 'terminal') {
      // no Raster here: a text list of rooms, every room, with its chips
      mounted = null
      const all = layoutPanel(snap.state, 200, 100_000)
      return (
        <Box flexDirection="column">
          {textRooms(all).map(line => (
            <Text>{line}</Text>
          ))}
          {chipRow(chipsOf(all), cols)}
        </Box>
      )
    }

    const { Raster } = $.ui.resolve(e)
    // the chips take up to CHIP_ROWS under the Raster; under 4 rows left, layoutPanel gives the summary
    const rowsGiven = Math.max(0, e.props.scroll.bodyRows - CHIP_ROWS)
    const model = layoutPanel(snap.state, cols, rowsGiven, anims)
    if (model.mode === 'summary') {
      mounted = null
      return <Text>{model.line}</Text>
    }
    if (model.rooms.length === 0) {
      mounted = null
      return <Text dimColor>No Claude Code sessions yet.</Text>
    }
    const rows = Math.max(1, Math.min(256, model.height))
    const { cells, chips } = renderFrame(model, cols, rows, frame)
    mounted = { cols, rows, model, cells }
    ensureFrames($)
    return (
      <Box flexDirection="column">
        <Raster key="office" columns={cols} rows={rows} cells={cells} />
        {chipRow(chips, cols)}
      </Box>
    )
  })
}
