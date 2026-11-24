# Office Plugin (pixel panel + /office) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one Claude plugin, type `/office`. A headless tracker starts if none is running, a pixel-art office panel opens beside the chat, and you get a link to the full office.

**Architecture:**
- The existing core and server get a headless entry point, bundled into one plain-JS file inside `plugin/`, together with the built scene.
- A hooks-module mod in the same plugin registers `/office`. It starts the tracker through a detached launcher, polls `GET /state` over localhost, and draws rooms with a terminal `Raster` that `$.ui.blit` animates.
- Pure logic (layout, sprites, snapshot diff, cell encoding) lives in plain TS modules that vitest tests directly.

**Tech Stack:** TypeScript, esbuild, Node 20+, the Claude Code plugin mod API (`claude-code` types), vitest, `claude plugin validate`, and `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-24-office-plugin-design.md`. Read its "Calls made after the builder check" section too.

**Mod API reference:** plugin-authoring skill files at `/private/tmp/claude-501/bundled-skills/2.1.327/7b406fb026ba0eeb2b785efa0d6faeff/plugin-authoring/`:
- `reference.md`
- `types/claude-code.d.ts` (about 14k lines; grep it)
- `examples/pane.tsx`, `pane.test.tsx`, `pane-state.d.ts`

## Global Constraints
- Everything is local. The tracker binds to 127.0.0.1 and requires the token. The mod only talks to 127.0.0.1.
- Never slow down Claude:
  - hooks stay async and silent
  - polling and animation never block a prompt
  - a missing tracker shows one quiet line, never an error flood
- The token never goes in process argv or logs. In the transcript, it appears only in the link `/office` replies with.
- Never start a second tracker when one answers on the configured port. Never rewrite `config.json` from the mod.
- The tracker bundle runs with plain `node <file>` (Node ≥ 20) and needs no `node_modules` at runtime.
- Built plugin artifacts are committed. Installing from the repo needs no build step.
- The plugin passes `claude plugin validate plugin` and `claude plugin test plugin`.
- Labels from session and agent data go in as text only, never interpreted.
- macOS first. The full feature runs in the terminal CLI. Other surfaces get the text fallback (spec call 3).

## Review Focus
1. `/office` while the desktop app is already running. Expected: it reuses the app's tracker, starts nothing, and `/office stop` doesn't kill the app.
2. `/office` twice in quick succession, or in two tabs. Expected: exactly one tracker process.
3. The tracker is killed while the panel is open. Expected: the panel shows "office tracker not running — run /office" and recovers by itself when the tracker comes back.
4. A very narrow pane (< 30 cols) and a very short inline pane (≤ 6 rows). Expected: a one-line summary, with no exception and no garbled cells.
5. A session with 15+ helpers, or 10+ sessions. Expected: the panel stays within its cells, with "+N" and "+N more", and frame time stays low.

---

### Task 1: Headless tracker, `/state`, bundle into the plugin

**Files:**
- Create: `src/tracker/main.ts` (headless entry)
- Create: `tools/build-plugin.ts`, and add a `build:plugin` script that `build` also runs
- Modify: `src/server/eventServer.ts` (GET /state, version), `src/core/app.ts` (idle-exit hook if needed)
- Output (committed): `plugin/tracker/tracker.mjs` and `plugin/tracker/scene/**`
- Test: `tests/stateEndpoint.test.ts`, `tests/trackerIdle.test.ts`, `tests/trackerBundle.test.ts`

**Interfaces:**
- Consumes: `startApp(opts)` (app.ts), `loadOrCreateConfig`, the scene build (`tools/build-scene.ts`).
- Produces:
  - `GET /state` → 200 `{ version: string; startedBy: 'plugin' | 'app' | 'serve'; seq: number; state: OfficeState }`. It requires header `X-Agent-Office-Token`; a missing or wrong token gets 401. `seq` increments on every store change.
  - `node plugin/tracker/tracker.mjs [--started-by plugin] [--idle-exit-min 30]`:
    - Starts `startApp` using `AGENT_OFFICE_DIR` or `~/.agent-office`, serving the scene from `plugin/tracker/scene`.
    - Logs to `<dir>/tracker.log`, rotated to `tracker.log.1` at 1 MB.
    - Exits 0 quietly if the port is already in use.
  - Pure function `shouldIdleExit(now: number, lastBusyAt: number, idleMin: number): boolean`, exported from `src/tracker/idle.ts`. "Busy" means at least one non-ended session or at least one WS client. The idle check applies only when started by the plugin.
  - Version: `package.json` `version`, injected at build time.

- [ ] **Step 1: Write the failing tests.**
  - `GET /state requires the token`: no header → 401; right header → 200 with `state.sessions` and a numeric `seq`.
  - `seq increases on store change`: apply a hook, then `seq` is greater than before.
  - `shouldIdleExit`: `(1000 + 30*60000, 1000, 30)` → true; `(1000 + 29*60000, 1000, 30)` → false.
  - `bundle runs under plain node`:
    - Run `npm run build:plugin`.
    - Spawn `node plugin/tracker/tracker.mjs` with `AGENT_OFFICE_DIR=<tmp>` and `CLAUDE_CONFIG_DIR=<empty tmp>`. Write `<tmp>/config.json` with a free port and a token first.
    - Poll `GET /state` until 200, within 5 s.
    - Assert that `GET /` serves the scene HTML.
    - Kill the process.
  - `second tracker on the same port exits 0`.
- [ ] **Step 2: Run them.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - esbuild: platform node, format esm, bundle everything including `ws`, banner `createRequire` if needed, and mark `bufferutil` and `utf-8-validate` external. `ws` treats them as optional.
  - Copy the built scene into `plugin/tracker/scene`.
- [ ] **Step 4: Run the full suite and `npm run build`.** Expect PASS.
- [ ] **Step 5: Commit** `feat: headless tracker bundle and /state endpoint`.

### Task 2: The mod: `/office`, launcher, lifecycle

**Files:**
- Create: `plugin/hooks/register.tsx` (the mod's hooks module) and `plugin/types/index.d.ts` (its `$.state` contract, if used)
- Create: `plugin/scripts/launch-tracker.sh`. POSIX sh. It starts `node "$1/tracker/tracker.mjs" --started-by plugin` detached (`nohup … >/dev/null 2>&1 &`), prints the child pid, exits 0, and exits 3 when `node` is missing or older than v20.
- Create: `plugin/mod/office.ts`, pure helpers: `parseConfig`, `classifyProbe`, `formatReply`.
- Modify: `plugin/hooks/hooks.json` and `plugin/.claude-plugin/plugin.json`. Keep the classic forwarding hooks working. If one plugin can't hold both classic `hooks` and `modules`, the mod forwards its own session's hook events with `$.http.fetch` instead and `forward.sh` stays for the desktop app. Record which in `docs/hook-notes.md`.
- Test: `tests/officeMod.test.ts` (vitest, pure helpers), `plugin/hooks/register.test.tsx` (`claude plugin test`)

**Interfaces:**
- Consumes: Task 1's `GET /state` shape and the tracker CLI.
- Produces:
  - `parseConfig(text: string): { port: number; token: string } | null`
  - `classifyProbe(res: { status: number; json?: unknown } | 'refused'): 'ours' | 'foreign' | 'down'`
    - 200 with `version` and `state` → `'ours'`
    - any other answer → `'foreign'`
    - connection refused or timeout → `'down'`
  - `formatReply(o: { port: number; token: string; started: boolean; appInstalled: boolean }): string`. It returns a short text: the panel is open, the full-office link `http://127.0.0.1:<port>/?token=<token>`, and an "open the desktop app instead" line when `appInstalled`.
  - Commands, registered in `session.start`:
    - `/office`: read the config, probe, launch if down, wait up to 3 s for the config and probe again, open the pane `agent-office`, reply.
    - `/office stop`: stop the tracker only if `startedBy === 'plugin'`. Use its pid, recorded in `<dir>/tracker.pid` by the tracker, or a `POST /shutdown` with the token added in this task.
  - Messages:
    - Node missing: "Agent Office needs Node.js 20 or newer — install it from nodejs.org, then run /office again."
    - Foreign port: "Port <p> is in use by something else. Change \"port\" in ~/.agent-office/config.json and run /office again."
    - Non-terminal surface with no tracker: "Run /office once in terminal Claude, or open the Agent Office app."

- [ ] **Step 1: Write the failing tests.**
  - vitest:
    - `parseConfig` handles valid JSON, garbage, and a missing token.
    - `classifyProbe` covers its three outcomes.
    - `formatReply` includes the link, and the app line only when `appInstalled`.
  - `claude plugin test`:
    - `/office starts the tracker when none answers`: stub `$.http.fetch` to refuse once and then answer `ours`; stub `$.process.run` to exit 0. Assert the launcher was run once and the pane was opened.
    - `/office reuses a running tracker`: fetch answers `ours`. The launcher is never run.
    - `/office reports node missing`: the launcher exits 3, and the reply says Node.js.
    - `/office reports a foreign port`.
  - Launcher, by hand: with `PATH` lacking node, it exits 3. With node present, it returns immediately and leaves a process running. Kill it afterwards.
- [ ] **Step 2: Run them.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - Locate the plugin root with `$.plugin.root`.
  - Read the config through `$.fs` and `$.env.get('AGENT_OFFICE_DIR')`.
  - Wrap every `$` call. A failure becomes one quiet line, never a thrown hook.
- [ ] **Step 4: Run** `npx vitest run`, `claude plugin validate plugin` and `claude plugin test plugin`. Expect PASS.
- [ ] **Step 5: Commit** `feat: /office command starts or reuses the tracker`.

### Task 3: Pixel office panel

**Files:**
- Create: `plugin/mod/pixels.ts`, which is pure:
  - `layoutPanel(state, cols, rows)`
  - `spriteFor(kind, frame)`
  - `renderFrame(model, cols, rows, frame) → { cells: string, chips: Chip[] }` (cells encoded as RasterProps expects)
  - `diffStates(prev, next) → AnimEvent[]`
- Modify: `plugin/hooks/register.tsx`. Add the `ui.render` hook for `{ component: 'Pane', requestId: 'agent-office' }`, the poll with `$.clock.every(1000)`, the animation with `$.clock.every(125)` plus `$.ui.blit`, the chips row of `Button`s, and the details view.
- Test: `tests/pixels.test.ts` (vitest), plus pane cases in `plugin/hooks/register.test.tsx`

**Interfaces:**
- Consumes: the `GET /state` body from Task 1, and the pane id `agent-office` and helpers from Task 2.
- Produces:
  - `AnimEvent = { kind: 'spawn' | 'handoff' | 'exit'; sessionId: string; agentId: string }`. Derived from state diffs:
    - an agent id is new → spawn
    - status becomes `handing_off` → handoff
    - an agent disappears or becomes `gone` → exit
  - Panel model per room:
    - a label (session `name`, else the `label` folder name)
    - the boss with a status sprite: working/delegating = typing, idle = still, waiting_on_team = lean, needs_you = blinking "!"
    - helpers at desks in `looksFor(type).color`; quiet = "z"
    - a status line: `<boss state> · <n> helpers · <tokens>`
  - Chips: `{ label: string; sessionId: string; agentId: string | 'boss' }`. Pressing one shows details: type or name, task, status, tokens in/out/cache, `~$cost (estimate)`, running time, and last activity. A "close" chip returns to the rooms.
  - Layout per spec call 2:
    - docked (rows ≥ 2 × cols / 3): stacked rooms
    - inline: side by side
    - "+N more" for rooms that don't fit
    - fewer than 30 cols or fewer than 4 rows: a one-line text summary
  - Not running: the line "office tracker not running — run /office". Recovers on the next successful poll.

- [ ] **Step 1: Write the failing tests.**
  - `diffStates`: new agent → spawn; status to `handing_off` → handoff; removed → exit; unchanged → [].
  - `layoutPanel`:
    - 40×40 with 3 sessions stacks 3 rooms.
    - 120×8 with 3 sessions puts them side by side.
    - 40×10 with 6 sessions shows "+N more".
    - 20×5 gives the summary mode.
  - `renderFrame`: the cells string length matches `cols*rows` encoding, and every label is clipped to the room width (a long name cannot overflow).
  - `renderFrame` is deterministic: same model, size and frame give an identical result.
  - Plugin test: with the pane open and a stubbed `/state` holding 2 sessions, the render tree contains a `Raster` keyed `office` and one chip per character. Pressing a chip shows its details.
- [ ] **Step 2: Run them.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - Half-block (`▀▄`) pixels: 2 vertical pixels per cell.
  - Only blit while the pane `isPlaced`.
  - Stop the timers on `session.end` and on reload.
  - Keep frame work proportional to visible rooms.
- [ ] **Step 4: Run** the vitest suite, `claude plugin validate plugin`, and `claude plugin test plugin`. Then live-check: start `claude --plugin-dir plugin` in a scratch folder (or rely on the hot-reload watch), run `/office`, and capture what the pane shows. If you can't see the screen, have the controller check. Expect PASS.
- [ ] **Step 5: Commit** `feat: pixel office panel`.

### Task 4: Fallback surface, docs, end-to-end

**Files:**
- Modify: `plugin/hooks/register.tsx`. On a non-terminal surface (`e.surface !== 'terminal'`), the pane shows a text list of rooms and agents with statuses from `/state`. With no tracker, it shows the spec message.
- Modify: `README.md`. Install the plugin, then `/office`, `/office stop`, the Node requirement, what the panel shows, and the desktop app as optional.
- Modify: `docs/hook-notes.md` with how the plugin forwards events (from Task 2).
- Test: plugin test `non-terminal surface shows a text list`.

- [ ] **Step 1: Write the failing plugin test.**
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run end to end.**
  - `npm run build`
  - `npx vitest run`
  - `claude plugin validate plugin`
  - `claude plugin test plugin`
  - Uninstall any installed copy, then `/plugin marketplace add <repo>` and `/plugin install agent-office`. The controller runs this with the person.
- [ ] **Step 4: Commit** `docs: plugin install and /office usage`.
