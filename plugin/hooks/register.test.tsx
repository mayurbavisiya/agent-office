import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/tmp/ao-test'
const CONFIG = `${DIR}/config.json`
const PORT = 47999
const TOKEN = 'tok-test-123'
const PLUGIN_VERSION = '0.1.0'

type Answer = 'refused' | 'hang' | { status: number; json?: unknown; text?: string }

const ours = (over: Record<string, unknown> = {}): Answer => ({
  status: 200,
  json: { version: PLUGIN_VERSION, startedBy: 'plugin', seq: 1, state: { sessions: {} }, ...over },
})

type World = {
  /** answers for GET /state, in order; the last repeats */
  state: Answer[]
  /** exit code the launcher answers, or 'deny' for a surface with no process noun */
  launch?: number | 'deny'
  /** config.json exists from the start (true) or only after the launcher ran ('after-launch') */
  config?: true | 'after-launch'
  appInstalled?: boolean
  shutdown?: number
}

function world(on: On, w: World) {
  const runs: string[][] = []
  const opened: string[] = []
  const posts: { url: string; headers: Record<string, string> }[] = []
  let launched = false
  let probes = 0

  const clock = mock.clock(on)
  mock.env(on, { AGENT_OFFICE_DIR: DIR, HOME: '/home/u' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) {
      return { value: JSON.stringify({ name: 'agent-office', version: PLUGIN_VERSION }) }
    }
    if (e.path === CONFIG) {
      const has = w.config === undefined || w.config === true || launched
      if (has) return { value: JSON.stringify({ port: PORT, token: TOKEN }) }
    }
    return { deny: 'ENOENT: no such file' }
  })
  on('fs.stat', (_, e) => {
    if (w.appInstalled && e.path === '/Applications/Agent Office.app') {
      return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    }
    return { deny: 'ENOENT: no such file' }
  })
  on('fs.exists', (_, e) => ({
    value: Boolean(w.appInstalled && e.path === '/Applications/Agent Office.app'),
  }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (w.launch === 'deny') return { deny: 'process is not available here' }
    launched = true
    return { value: {
        exitCode: w.launch ?? 0,
        stdout: '4242\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      } }
  })
  on('http.fetch', (_, e) => {
    const headers = (e.init?.headers ?? {}) as Record<string, string>
    if (e.url.endsWith('/shutdown')) {
      posts.push({ url: e.url, headers })
      const status = w.shutdown ?? 202
      return { value: { status, ok: status < 300, headers: {}, text: '' } }
    }
    const a = w.state[Math.min(probes, w.state.length - 1)]
    probes++
    if (a === 'hang') return new Promise<never>(() => undefined)
    if (a === undefined || a === 'refused') return { deny: 'connect ECONNREFUSED 127.0.0.1' }
    const text = a.text ?? (a.json === undefined ? '' : JSON.stringify(a.json))
    return { value: { status: a.status, ok: a.status < 300, headers: {}, text } }
  })

  return { runs, opened, posts, clock, probes: () => probes }
}

async function office($: Engine, args = '') {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'office',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  return r.text ?? ''
}

/** Runs `/office` while moving the mocked clock, so waits on it come due. */
async function officeOverTime(
  $: Engine,
  clock: ReturnType<typeof mock.clock>,
  args = '',
): Promise<{ text: string; clockMs: number; realMs: number }> {
  const t0 = Date.now()
  const c0 = clock.now()
  let done = false
  const run = office($, args).finally(() => {
    done = true
  })
  for (let i = 0; i < 100 && !done; i++) await clock.advance(100)
  const text = await run
  return { text, clockMs: clock.now() - c0, realMs: Date.now() - t0 }
}

test('/office starts the tracker when none answers', async ($, on) => {
  const w = world(on, { state: ['refused', ours()] })
  const text = await office($)

  expect(w.runs.length).toBe(1)
  expect(w.runs[0]?.some(a => a.endsWith('/scripts/launch-tracker.sh'))).toBe(true)
  expect(w.runs[0]?.some(a => a.includes(TOKEN))).toBe(false)
  expect(w.opened).toEqual(['agent-office'])
  expect(text).toContain(`http://127.0.0.1:${PORT}/?token=${TOKEN}`)
  expect(text).toMatch(/started/i)
})

test('/office waits for the config the tracker writes on first run', async ($, on) => {
  const w = world(on, { state: [ours()], config: 'after-launch' })
  const text = await office($)

  expect(w.runs.length).toBe(1)
  expect(w.opened).toEqual(['agent-office'])
  expect(text).toContain(`http://127.0.0.1:${PORT}/?token=${TOKEN}`)
})

test('/office reuses a running tracker', async ($, on) => {
  const w = world(on, { state: [ours()] })
  const text = await office($)

  expect(w.runs.length).toBe(0)
  expect(w.opened).toEqual(['agent-office'])
  expect(text).toContain(`http://127.0.0.1:${PORT}/?token=${TOKEN}`)
  expect(text).not.toMatch(/desktop app/i)
})

test('/office mentions the desktop app when it is installed', async ($, on) => {
  world(on, { state: [ours()], appInstalled: true })
  expect(await office($)).toMatch(/desktop app/i)
})

test('/office reports node missing', async ($, on) => {
  const w = world(on, { state: ['refused'], launch: 3 })
  const text = await office($)

  expect(w.runs.length).toBe(1)
  expect(text).toBe(
    'Agent Office needs Node.js 20 or newer — install it from nodejs.org, then run /office again.',
  )
  expect(w.opened).toEqual([])
})

test('/office reports a foreign port', async ($, on) => {
  const w = world(on, { state: [{ status: 404, text: 'not found' }] })
  const text = await office($)

  expect(w.runs.length).toBe(0)
  expect(text).toBe(
    `Port ${PORT} is in use by something else. Change "port" in ~/.agent-office/config.json and run /office again.`,
  )
  expect(w.opened).toEqual([])
})

test('/office on a surface that cannot run processes points to the terminal', async ($, on) => {
  world(on, { state: ['refused'], launch: 'deny' })
  expect(await office($)).toBe(
    'Run /office once in terminal Claude, or open the Agent Office app.',
  )
})

test('/office restarts a plugin tracker of another version', async ($, on) => {
  const w = world(on, { state: [ours({ version: '0.0.9' }), 'refused', ours()] })
  const text = await office($)

  expect(w.posts.length).toBe(1)
  expect(w.posts[0]?.headers['X-Agent-Office-Token']).toBe(TOKEN)
  expect(w.runs.length).toBe(1)
  expect(w.opened).toEqual(['agent-office'])
  expect(text).toContain(`/?token=${TOKEN}`)
})

test('/office leaves an app tracker of another version alone', async ($, on) => {
  const w = world(on, { state: [ours({ version: '0.0.9', startedBy: 'app' })] })
  await office($)

  expect(w.posts.length).toBe(0)
  expect(w.runs.length).toBe(0)
  expect(w.opened).toEqual(['agent-office'])
})

test('/office stop stops a plugin tracker', async ($, on) => {
  const w = world(on, { state: [ours()] })
  const text = await office($, 'stop')

  expect(w.posts.length).toBe(1)
  expect(w.posts[0]?.url).toBe(`http://127.0.0.1:${PORT}/shutdown`)
  expect(w.posts[0]?.headers['X-Agent-Office-Token']).toBe(TOKEN)
  expect(text).toBe('Stopped the office tracker.')
})

test('/office stop leaves the app tracker running', async ($, on) => {
  const w = world(on, { state: [ours({ startedBy: 'app' })] })
  const text = await office($, 'stop')

  expect(w.posts.length).toBe(0)
  expect(text).toBe(
    'The office tracker is run by the Agent Office app — quit it from the menu bar.',
  )
})

test('/office stop with nothing running', async ($, on) => {
  const w = world(on, { state: ['refused'] })
  const text = await office($, 'stop')

  expect(w.posts.length).toBe(0)
  expect(w.runs.length).toBe(0)
  expect(text).toBe('No office tracker is running.')
})

test('the pane draws a placeholder on every surface', async ($, on) => {
  world(on, { state: [ours()] })
  await office($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-office',
      surface,
      component: 'Pane',
      requestId: 'agent-office',
      props: {
        title: 'Agent Office',
        isFocused: false,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    expect((await ui.find({ type: 'Text', text: /Agent Office/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /running/ }))?.text).toBeDefined()
    await ui.unmount()
  }
})

test('/office answers with one line when the port never replies', async ($, on) => {
  const w = world(on, { state: ['hang'] })
  const { text, clockMs, realMs } = await officeOverTime($, w.clock)

  expect(text.split('\n').length).toBe(1)
  expect(text).toMatch(/didn't answer within 3 seconds/)
  expect(w.runs.length).toBe(1)
  expect(w.opened).toEqual([])
  // first probe (0.5 s) + about 3 s of polling, each probe bounded to 0.5 s
  expect(clockMs).toBeLessThanOrEqual(4500)
  expect(realMs).toBeLessThan(5000)
})

test('/office stop answers when the tracker never replies to the shutdown', async ($, on) => {
  on('http.fetch', { url: `http://127.0.0.1:${PORT}/shutdown` }, () => new Promise<never>(() => undefined))
  const w = world(on, { state: [ours()] })
  const { text } = await officeOverTime($, w.clock, 'stop')

  expect(text).toBe('No office tracker is running.')
})

test('/office keeps an old tracker that will not stop for the update', async ($, on) => {
  const w = world(on, { state: [ours({ version: '0.0.9' })] })
  const { text, clockMs } = await officeOverTime($, w.clock)

  expect(w.posts.length).toBe(1)
  expect(w.runs.length).toBe(0)
  expect(w.opened).toEqual(['agent-office'])
  expect(text.split('\n')[0]).toBe(
    "Couldn't restart the office tracker for the update; using the running one.",
  )
  expect(text).toContain(`/?token=${TOKEN}`)
  expect(clockMs).toBeLessThanOrEqual(4500)
})
