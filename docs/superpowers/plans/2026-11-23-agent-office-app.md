# Agent Office (Plan 1: Working App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin plus an Electron floating-window app that shows every active local Claude Code session as an animated office room. Each room has a boss (the main agent) and team characters (subagents). Clicking a character opens an info panel.

**Architecture:**
- Async command hooks in a Claude Code plugin POST each hook event to a localhost event server inside the app.
- The app's core runs in Node and has three parts:
  - a state store, driven by hook events and timers
  - a log watcher that tails Claude Code's `.jsonl` logs for tokens and tools
  - an HTTP/WebSocket server that also serves the office scene
- The scene is a plain web page (SVG + CSS + TS) that renders state pushed over WebSocket. The Electron window simply loads it from the local server, so phase 2 (the browser version) is just opening the same URL.

**Tech Stack:**
- Node (v26 installed), TypeScript, Electron (pin the exact latest stable version at install)
- `ws` for WebSocket, esbuild to bundle the scene, Vitest for tests
- POSIX `sh` + `curl` for the hook script

**Spec:** `docs/superpowers/specs/2026-11-23-agent-office-design.md`. Read it before starting.

**Out of scope here (Plan 2: Release):** code signing and notarization, auto-update, publishing the plugin marketplace, the first-run setup UI, and Windows/Linux builds.

## Global Constraints

- Everything stays on the machine. Servers bind to `127.0.0.1` only. No outbound network requests, no telemetry.
- Hooks must never slow Claude Code down:
  - every hook is `"type": "command"` with `"async": true`
  - the script uses `curl --max-time 1`
  - the script always exits 0, including when the app isn't running, the config is missing, or curl fails
- The hook script needs only POSIX `sh` and `curl`. No `jq`, no Node.
- Locate Claude's folder as `$CLAUDE_CONFIG_DIR`, falling back to `~/.claude`. Logs live under `<claudeDir>/projects/`.
- App config file: `~/.agent-office/config.json` (file mode 0600), shaped `{ "port": 47821, "token": "<64 hex chars>" }`. The default port is 47821.
- Hook events are authenticated by the header `X-Agent-Office-Token: <token>`. WebSocket clients authenticate with `?token=<token>`.
- Timing rules:
  - "Maybe stuck" = a running subagent with no activity for **180 s** (configurable)
  - Discovery shows logs modified in the last **10 min**
  - A session is *ended* after SessionEnd or **30 min** without activity
- Log parsing is optional enrichment. The office and animations must work from hook events alone. Missing values show as `—`.
- macOS first. Avoid Mac-only APIs outside `src/main/`.

## Review Focus

1. **App not running, or port 47821 taken by something else.** Hooks still exit 0 within ~1 s. The app shows a clear error ("port 47821 in use") instead of a blank window. → Task 6 (port-in-use test) and Task 7 (no-server test).
2. **Log file read mid-write**, ending in a partial JSON line or containing a huge line. The watcher buffers until a newline, skips bad lines and never crashes. → Task 5 test.
3. **Events out of order or for unknown sessions/agents:**
   - SubagentStop arrives with no SubagentStart
   - the app starts mid-session
   - PostToolUse arrives before anything else
   
   The store creates entries on demand and never throws. → Task 4 test.
4. **Many sessions at once (8+).** Rooms stay legible, with a minimum room size and the floor scrolling. → Task 9 layout test.
5. **Bad requests:** malformed JSON, a wrong or missing token, or an oversized body (> 1 MB) get 400/401/413 and the server keeps running. → Task 6 test.

---

## File Structure

```
agent-office/
  package.json  tsconfig.json  vitest.config.ts  .gitignore
  .claude-plugin/marketplace.json      # local marketplace → ./plugin
  plugin/
    .claude-plugin/plugin.json
    hooks/hooks.json
    scripts/forward.sh                 # stdin → POST to app; always exit 0
  src/shared/types.ts                  # hook events, office state, WS messages
  src/shared/config.ts                 # app config + claudeDir resolution
  src/core/pricing.ts                  # price table + cost estimate + context sizes
  src/core/logParser.ts                # one .jsonl line → LogDelta; stats aggregation
  src/core/logWatcher.ts               # tail files, emit deltas
  src/core/discovery.ts                # find active sessions at launch
  src/core/store.ts                    # OfficeStore state machine
  src/server/eventServer.ts            # POST /event, WS /ws, static scene
  src/scene/index.html  styles.css
  src/scene/main.ts                    # WS client + render loop
  src/scene/layout.ts                  # room grid math
  src/scene/looks.ts                   # agent type → color/accessory
  src/scene/characters.ts              # SVG builders (ported from mockup)
  src/scene/animator.ts                # office events → animation steps
  src/scene/panel.ts                   # info panel + formatting
  src/main/main.ts                     # Electron: window, tray, wiring
  src/main/windowState.ts              # persist bounds/opacity
  tools/capture.ts                     # spike: dump raw hook events
  tools/demo.ts                        # replay fixtures into a running app
  tests/fixtures/hooks/*.jsonl  tests/fixtures/logs/*.jsonl
  docs/hook-notes.md                   # spike findings
```

---

### Task 1: Repo scaffold + logging spike

Settles the spec's "Unknowns to settle first". Everything after this depends on the recorded fixtures.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`, `plugin/scripts/forward.sh`, `tools/capture.ts`, `docs/hook-notes.md`, `tests/fixtures/hooks/*.jsonl`, `tests/fixtures/logs/*.jsonl`

**Interfaces:**
- Produces:
  - `npm test` (vitest), `npm run build`
  - `docs/hook-notes.md`, recording:
    - the Agent tool's exact `tool_name` (`Agent` or `Task`) and the field names in its `tool_input`
    - how the parent's `tool_use_id` relates to the child's `agent_id`
    - whether a nested SubagentStart carries the parent's `agent_id`
    - how a teammate can be linked to its lead
    - what `SessionStart.source` looks like on `/clear` and resume
    - the real event order
  - fixture files used by Tasks 3–8

- [ ] **Step 1:** Set up git and the project skeleton:
  - `git init`
  - `.gitignore` covering `node_modules/`, `dist/`, `.superpowers/`, `out/`
  - `npm init`, then install the dev dependencies `typescript vitest esbuild @types/node @types/ws` and the dependency `ws`
  - `tsconfig.json`: strict, ES2022, NodeNext
- [ ] **Step 2:** Write `plugin/scripts/forward.sh`:
  - reads stdin
  - reads `port` and `token` from `~/.agent-office/config.json` using `sed`/`grep` only
  - runs `curl -s --max-time 1 -o /dev/null -X POST -H "Content-Type: application/json" -H "X-Agent-Office-Token: $token" --data-binary @- "http://127.0.0.1:$port/event"`
  - ends with `exit 0` unconditionally
  - `chmod +x`
- [ ] **Step 3:** Write `plugin/hooks/hooks.json`:
  - registers `"$CLAUDE_PLUGIN_ROOT"/scripts/forward.sh` as `{"type":"command","async":true}`
  - for SessionStart, SessionEnd, UserPromptSubmit, Stop, Notification, SubagentStart, SubagentStop, PreToolUse and PostToolUse, with matcher `""` / `"*"` where matchers apply
  
  Also write `plugin.json` (name `agent-office`) and the root `marketplace.json` listing `./plugin`.
- [ ] **Step 4:** Write `tools/capture.ts`. It runs an HTTP server on the configured port, checks the token, and appends each body as one line to `tests/fixtures/hooks/capture-<timestamp>.jsonl`. It also writes `~/.agent-office/config.json` if missing.
- [ ] **Step 5:** Record the scenarios. With the capture server running, run each of these headless with the plugin loaded (`claude -p "<prompt>" --plugin-dir ./plugin`):
  - (a) "use one Explore subagent to list the files in this folder"
  - (b) "run two Explore subagents in parallel: one lists files, one counts lines in package.json"
  - (c) a prompt that makes a general-purpose subagent spawn its own subagent
  - (d) a prompt that triggers a background agent, if supported
  
  Rename the outputs to `single-subagent.jsonl`, `parallel-subagents.jsonl`, `nested-subagent.jsonl` and `background-agent.jsonl`. Then copy the matching main and subagent logs from `<claudeDir>/projects/...` into `tests/fixtures/logs/`, replacing file contents and prompts with placeholder text.
  
  If `--plugin-dir` isn't supported, install via `/plugin marketplace add <path-to-agent-office>` and record in an interactive session instead. Ask the person to run `/clear` and resume once in an interactive session, and capture `clear-resume.jsonl`.
- [ ] **Step 6:** Write `docs/hook-notes.md`, answering each item listed under Produces with a quoted example line from the fixtures.
- [ ] **Step 7:** Commit (`chore: scaffold + hook logging spike fixtures`).

---

### Task 2: Shared types and config

**Files:**
- Create: `src/shared/types.ts`, `src/shared/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces, in `types.ts` (adjust field names to match `docs/hook-notes.md`, keeping these type names):
  - `HookEvent` = `{ hook_event_name: string; session_id: string; transcript_path?: string; cwd?: string; agent_id?: string; agent_type?: string; source?: string; reason?: string; tool_name?: string; tool_input?: Record<string, unknown>; tool_use_id?: string; agent_transcript_path?: string; notification_type?: string; message?: string; session_title?: string; [k: string]: unknown }`
  - `AgentStats` = `{ model?: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; contextFill?: number /*0..1*/; tools: Record<string, number>; files: string[]; recent: string[] /*max 20*/; lastActivity: number }`
  - `AgentStatus` = `'spawning'|'working'|'quiet'|'handing_off'|'gone'`
  - `BossStatus` = `'working'|'delegating'|'waiting_on_team'|'idle'|'needs_you'`
  - `Agent` = `{ id: string; sessionId: string; parentId: string | null /*null = child of boss*/; type: string; task?: string; status: AgentStatus; startedAt: number; endedAt?: number; stats: AgentStats }`
  - `Session` = `{ id: string; cwd: string; label: string /*folder name*/; subLabel?: string /*title or short id when same folder*/; branch?: string; status: 'active'|'ended'; boss: { status: BossStatus; startedAt: number; stats: AgentStats }; agents: Record<string, Agent>; lastActivity: number }`
  - `OfficeState` = `{ sessions: Record<string, Session> }`
  - `OfficeEvent` is a union of:
    - `{kind:'spawned', sessionId, agentId}`
    - `{kind:'handoff', sessionId, agentId, toId: string | 'boss'}`
    - `{kind:'left', sessionId, agentId}`
    - `{kind:'shift_change', fromSessionId, toSessionId}`
    - `{kind:'session_started'|'session_ended', sessionId}`
  - `ServerMessage` = `{type:'snapshot', state: OfficeState} | {type:'events', events: OfficeEvent[], state: OfficeState}`
- Produces, in `config.ts`:
  - `loadOrCreateConfig(dir = ~/.agent-office): { port: number; token: string }`
  - `claudeDir(env = process.env): string`

- [ ] **Step 1: Write the failing tests** in `tests/config.test.ts`:
  - `creates config with port 47821 and 64-hex token, mode 0600` (temp dir)
  - `returns existing config unchanged on second call`
  - `claudeDir uses CLAUDE_CONFIG_DIR when set, else ~/.claude`
- [ ] **Step 2:** Run `npx vitest run tests/config.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` and `config.ts`. Generate the token with `crypto.randomBytes(32).toString('hex')`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: shared types and config`).

---

### Task 3: Log parser and pricing

**Files:**
- Create: `src/core/logParser.ts`, `src/core/pricing.ts`
- Test: `tests/logParser.test.ts`, `tests/pricing.test.ts`

**Interfaces:**
- Consumes: `AgentStats` (Task 2)
- Produces:
  - `type LogDelta = { timestamp?: number; model?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }; toolUses: { name: string; input: Record<string, unknown> }[] }`
  - `parseLogLine(line: string): LogDelta | null` returns null for blank, invalid or irrelevant lines and never throws
  - `emptyStats(now: number): AgentStats`
  - `applyDelta(stats: AgentStats, d: LogDelta): AgentStats`
  - `contextSize(model?: string): number | undefined`
  - `estimateCost(stats: AgentStats): number | null` returns null when the model is unknown

- [ ] **Step 1: Write the failing tests** using the `tests/fixtures/logs/` files from Task 1:
  - `parses assistant usage: input/output/cache_read_input_tokens/cache_creation_input_tokens and model`
  - `extracts tool_use blocks as toolUses with name and input`
  - `returns null for garbage, blank, and non-assistant lines`
  - `applyDelta sums tokens, counts tools, adds file_path/path/pattern inputs to files (deduped), keeps last 20 recent entries like "Grep authMiddleware"`
  - `contextFill = (input+cacheRead+cacheWrite of latest usage) / contextSize(model)`
  - `estimateCost returns null for unknown model`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep every per-model value (input/output/cache prices per million tokens, context size) in one `MODELS` table in `pricing.ts`, filled from Anthropic's current pricing and models pages at implementation time. Don't guess numbers: a model missing from the table yields `null` / `undefined`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: log line parser and cost estimate`).

---

### Task 4: Office store (state machine)

The heart of the app. Follow the spec's "Session and agent states" and "Claude's calls" sections exactly.

**Files:**
- Create: `src/core/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: types (Task 2); `LogDelta`, `applyDelta`, `emptyStats` (Task 3)
- Produces: `class OfficeStore` with:
  - `constructor(opts?: { stuckMs?: number /*180_000*/; endedMs?: number /*1_800_000*/ })`
  - `applyHook(e: HookEvent, now: number): OfficeEvent[]`
  - `applyLog(sessionId: string, agentId: string | null /*null = boss*/, d: LogDelta, now: number): void`
  - `tick(now: number): OfficeEvent[]` handles quiet → stuck, gone cleanup and ended sessions
  - `snapshot(): OfficeState`
  - `onChange(cb: (events: OfficeEvent[]) => void): void`

- [ ] **Step 1: Write the failing tests.** Drive them by replaying fixture files through `applyHook` with synthetic `now` values:
  - `SessionStart creates session with label = basename(cwd), boss idle`
  - `UserPromptSubmit → boss working`
  - `SubagentStart creates agent (status spawning→working), emits spawned; task filled from matching Agent PreToolUse per hook-notes`
  - `SubagentStop → handing_off, emits handoff toId 'boss'; after handoff the agent becomes gone and emits left`
  - `nested: child's SubagentStop emits handoff toId = parent agent id`
  - `no activity for 180s → quiet; any PreToolUse/PostToolUse/applyLog for that agent → working`
  - `Stop with no running agents → boss idle; Stop with running agents → waiting_on_team`
  - `Notification (permission/input) → needs_you; cleared by next UserPromptSubmit or PreToolUse`
  - `SessionEnd → ended + session_ended; 30 min no activity → ended`
  - `SessionStart source clear/resume in same cwd as a session idle/quiet → takes over room, emits shift_change, no second room`
  - `two live sessions same cwd → both have subLabel (session_title or first 6 chars of id)`
  - `teammate session linkable to its lead (rule from hook-notes) → appears as an agent in the lead's room; unlinkable → its own room`
  - `room stays non-idle while any agent is working, even after Stop`
  - Review Focus 3: `SubagentStop / PostToolUse for unknown session or agent creates entries on demand and never throws`
- [ ] **Step 2:** Run `npx vitest run tests/store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `OfficeStore`. Keep state transitions in a single `transition()` function per entity, so the rules sit in one place.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: office state store`).

---

### Task 5: Log watcher and discovery

**Files:**
- Create: `src/core/logWatcher.ts`, `src/core/discovery.ts`
- Test: `tests/logWatcher.test.ts`, `tests/discovery.test.ts`

**Interfaces:**
- Consumes: `parseLogLine` (Task 3); `claudeDir` (Task 2)
- Produces:
  - `class LogWatcher` with:
    - `watch(sessionId, agentId: string | null, path)`
    - `unwatch(path)`
    - `on('delta', (sessionId, agentId, d: LogDelta) => void)`
    - `close()`
    
    It polls file size every 1000 ms and reads only the new bytes.
  - `discoverActiveSessions(claudeDir: string, now: number, windowMs = 600_000): { sessionId: string; cwd?: string; mainLog: string; subagentLogs: { agentId: string; path: string }[] }[]`
  - `subagentLogPath(claudeDir, transcriptPath, agentId): string` follows `<session-dir>/subagents/agent-<agentId>.jsonl`

- [ ] **Step 1: Write the failing tests:**
  - `emits deltas for lines appended after watch starts`
  - Review Focus 2: `buffers a partial last line until its newline arrives`
  - Review Focus 2: `skips a 5 MB garbage line without crashing`
  - `handles file truncation/rotation by restarting from 0`
  - `discovery returns sessions with main log mtime within 10 min, with their subagent logs; ignores older ones` (temp dir tree)
  - `discovery honours a claudeDir passed from CLAUDE_CONFIG_DIR`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `fs.promises.open` plus positional reads, and keep a per-file offset and leftover buffer.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: log watcher and session discovery`).

---

### Task 6: Event server

**Files:**
- Create: `src/server/eventServer.ts`, `src/core/app.ts` (wires store + watcher + server and is shared by Electron and the demo)
- Test: `tests/eventServer.test.ts`

**Interfaces:**
- Consumes: `OfficeStore` (Task 4), `LogWatcher` and `discoverActiveSessions` (Task 5), config (Task 2)
- Produces:
  - `startEventServer(opts: { port: number; token: string; store: OfficeStore; staticDir: string }): Promise<{ url: string; close(): Promise<void> }>`. It rejects with `Error('port 47821 in use')` (using the actual port) on EADDRINUSE.
  - `startApp(opts?: { port?; token?; claudeDir?; staticDir? }): Promise<{ url: string; store: OfficeStore; close() }>`. It:
    - loads config
    - runs discovery and replays discovered logs into the store
    - starts the server
    - on each hook event, calls `store.applyHook`, then watches `transcript_path` (boss) and subagent logs (from `agent_transcript_path`, or `subagentLogPath` on SubagentStart)
    - calls `store.tick` every 1000 ms
- Server routes:
  - `POST /event` → 204
  - `GET /ws?token=` → WebSocket. On connect it sends `{type:'snapshot'}`, then `{type:'events'}` on every change.
  - `GET /*` → static files from `staticDir`
  - binds to 127.0.0.1

- [ ] **Step 1: Write the failing tests:**
  - `POST /event with valid token → 204 and store updated`
  - Review Focus 5: `missing/wrong token → 401; malformed JSON → 400; body > 1 MB → 413; server still serves next request`
  - `WS without token is rejected; with token receives snapshot then events after a POST`
  - Review Focus 1: `second server on same port rejects with "port <n> in use"`
  - `binds only to 127.0.0.1`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:http` and `ws` (`WebSocketServer({ noServer: true })` on `upgrade`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: local event server and app wiring`).

---

### Task 7: Hook script hardening

**Files:**
- Modify: `plugin/scripts/forward.sh`
- Test: `tests/forward.test.ts` (spawns the script with `sh` and a temporary `HOME`)

**Interfaces:**
- Consumes: `startEventServer` (Task 6)
- Produces: a final plugin that is ready to install

- [ ] **Step 1: Write the failing tests:**
  - `forwards stdin JSON with token header to running server`
  - Review Focus 1: `with no server running, exits 0 in under 1500 ms`
  - `with missing config file, exits 0 immediately and sends nothing`
  - `with 300 KB stdin payload, forwards intact`
- [ ] **Step 2:** Run the tests. Expected: any that fail are fixed in Step 3.
- [ ] **Step 3:** Fix the script until everything passes. Use `--data-binary @-` so large payloads stream, and `|| true` around curl.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit (`test: harden hook forwarder`).

---

### Task 8: Demo mode

This lets the scene be built and checked without live Claude sessions.

**Files:**
- Create: `tools/demo.ts`; add `"demo"` and `"serve"` scripts to `package.json`

**Interfaces:**
- Consumes: `startApp` (Task 6); fixtures (Task 1)
- Produces:
  - `npm run serve`: starts the app core plus server without Electron and prints the URL including the token
  - `npm run demo -- [--speed 2] [--sessions 3]`: replays the hook fixtures into the running server as N fake sessions, each with a distinct cwd label, keeping relative timing scaled by speed and looping forever

- [ ] **Step 1: Write the failing test** `tests/demo.test.ts`: `demo with --sessions 3 --speed 50 produces 3 sessions with agents in the store within 2 s`
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement `tools/demo.ts`, rewriting `session_id`/`cwd`/`agent_id` per fake session.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit (`feat: demo replay mode`).

---

### Task 9: Scene foundations (floor, rooms, characters)

**Files:**
- Create: `src/scene/index.html`, `styles.css`, `main.ts`, `layout.ts`, `looks.ts`, `characters.ts`; add a `build:scene` esbuild script that outputs to `dist/scene/`
- Test: `tests/layout.test.ts`, `tests/looks.test.ts`

**Interfaces:**
- Consumes: `ServerMessage` and `OfficeState` (Task 2); the server's static `/` and `/ws` (Task 6)
- Produces:
  - `layoutRooms(n: number, width: number, height: number): { x: number; y: number; w: number; h: number }[]`, with a minimum room size of 320×220
  - `looksFor(type: string): { color: string; accessory: 'crown'|'headphones'|'glasses'|'notepad'|'hat'|'none' }`
  - `renderCharacter(opts: { id: string; color: string; accessory; mood: 'happy'|'focus'|'worried'|'sleepy'; pose: 'type'|'scratch'|'carry'|'wave'|'walk'|'raise_hand'; name: string; tokens: string }): SVGGElement`
  - `renderRoom(session: Session, rect): SVGGElement`

- [ ] **Step 1: Write the failing tests:**
  - Review Focus 4: `layoutRooms(1..3) fills width in one row; layoutRooms(8, 900, 500) keeps rooms ≥ 320×220 and returns total height > 500 (floor scrolls)`
  - `looksFor is stable per type: Explore → headphones, Plan → notepad, code-reviewer → glasses, main → crown; unknown types get a stable hashed color`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - Port the characters, desks, door, window, clock and whiteboard from `.superpowers/brainstorm/86821-1795449596/content/office-v2.html`, using its CSS keyframes (blink, type, scratch, step, sweat, scroll, steam).
  - Each room is a scaled-down office with a sign showing `label` + `subLabel` + `branch`.
  - `main.ts` reads `token` from `location.search`, connects to `/ws`, reconnects with backoff, and re-renders on snapshot.
  - Show a "Waiting for Claude Code sessions…" empty state when there are no sessions.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm run build:scene && npm run serve` plus `npm run demo -- --sessions 3`, open the printed URL, and check that the rooms and characters render.
- [ ] **Step 5:** Commit (`feat: office scene rooms and characters`).

---

### Task 10: Animator

**Files:**
- Create: `src/scene/animator.ts`
- Test: `tests/animator.test.ts`

**Interfaces:**
- Consumes: `OfficeEvent` (Task 2); `renderCharacter` and room geometry (Task 9)
- Produces:
  - `planAnimations(events: OfficeEvent[], state: OfficeState): AnimStep[]`
  - `AnimStep` = `{ agentId: string; sessionId: string; kind: 'enter_door'|'walk_to_desk'|'walk_to'|'give'|'celebrate'|'exit_door'|'shift_change'|'fade_in_room'|'fade_out_room'; targetId?: string; durationMs: number }`
  - `runAnimations(steps: AnimStep[], svgRoot: SVGSVGElement): void` uses the Web Animations API, queued per agent

- [ ] **Step 1: Write the failing tests** (on `planAnimations` only):
  - `spawned → [enter_door 1200, walk_to_desk 2000]`
  - `handoff to boss → [walk_to boss 2000, give 800, celebrate(boss) 1200]`, then `left → [exit_door 2000]`
  - `handoff to parent agent → walk_to that agent, not boss`
  - `shift_change → one shift_change step`
  - `session_started/ended → fade_in_room / fade_out_room`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the planner and the runner. Status poses come from state, not animations:
  - quiet → scratch pose, sweat, red timer, red monitor
  - boss `needs_you` → raise_hand with a "!" bubble
  - `idle` → sleepy mood with "zzz"
  - `waiting_on_team` → tapping foot
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run the demo and watch one full spawn → work → handoff → exit cycle.
- [ ] **Step 5:** Commit (`feat: agent life-cycle animations`).

---

### Task 11: Info panel, room zoom, live counters

**Files:**
- Create: `src/scene/panel.ts`
- Modify: `src/scene/main.ts`
- Test: `tests/panel.test.ts`

**Interfaces:**
- Consumes: `Agent`, `Session`, `AgentStats` (Task 2); `estimateCost` (Task 3, bundled into the scene)
- Produces:
  - `formatTokens(n?: number): string`: `undefined` → "—", 950 → "950", 48210 → "48.2k", 1_250_000 → "1.25M"
  - `formatDuration(ms: number): string`: 812000 → "13m 32s"
  - `formatCost(c: number | null): string`: null → "—", 0.4581 → "~$0.458"
  - `panelModel(target: { session: Session; agentId: string | 'boss' }, now: number): PanelModel`. `PanelModel` holds the displayed fields: name, type, task, status label, model, the four token counts, duration and start time, cost, context %, tools sorted by count, files, recent, and team totals (`spawned`/`done`/`stuck`) for the boss.

- [ ] **Step 1: Write the failing tests** for the three formatters with the values above, plus:
  - `panelModel for boss includes team totals spawned/done/stuck`
  - `panelModel with empty stats shows "—" for model, tokens, cost, context`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Panel markup follows the mockup's right-hand panel.
  - Clicking a character opens the panel. Clicking a room zooms it to fill the window (a CSS transform on the room group). Esc or a second click returns to the floor.
  - Name-tag token counters and the open panel refresh once a second from the latest state.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then click characters in the demo.
- [ ] **Step 5:** Commit (`feat: info panel and room zoom`).

---

### Task 12: Electron floating window and tray

**Files:**
- Create: `src/main/main.ts`, `src/main/windowState.ts`; add `"start"` script (`electron dist/main/main.js`)
- Test: `tests/windowState.test.ts`

**Interfaces:**
- Consumes: `startApp` (Task 6); `dist/scene` (Task 9)
- Produces:
  - `loadWindowState(file): { x?: number; y?: number; width: number /*720*/; height: number /*420*/; opacity: number /*1*/; alwaysOnTop: boolean /*true*/; compact: boolean /*false*/ }`
  - `saveWindowState(file, s)`, with the state file at `~/.agent-office/window.json`

- [ ] **Step 1: Write the failing tests:**
  - `defaults when file missing or corrupt`
  - `round-trips saved state`
  - `clamps opacity to 0.3..1`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `main.ts`:
  - Window: `BrowserWindow({ frame: false, transparent: true, alwaysOnTop, resizable: true, hasShadow: false })`, loading `<url>/?token=…` from `startApp`. Dragging works via a CSS `-webkit-app-region: drag` strip at the floor's top edge.
  - Tray menu with: Show/Hide, Opacity (30/50/75/100%), Compact strip, Always on top, Launch at login (`app.setLoginItemSettings`), Quit.
  - Compact strip mode resizes the window to a 720×90 strip showing each room's boss plus agent counts. The scene switches layout on `?compact=1` or a WS message.
  - If `startApp` rejects with "port … in use", show a small error window with that message (Review Focus 1).
  - Save window state on move, resize and change.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `npm run build && npm start` with `npm run demo -- --sessions 3`, and check that the window floats on top, drags, resizes, and the opacity and compact settings stick after a restart.
- [ ] **Step 5:** Commit (`feat: Electron floating office window and tray`).

---

### Task 13: Live end-to-end check + README

**Files:**
- Create: `README.md`

- [ ] **Step 1:** Install the plugin from the local marketplace (`/plugin marketplace add <path-to-agent-office>`, then `/plugin install agent-office`) and start the app with `npm start`.
- [ ] **Step 2:** In two real terminal sessions in different folders, run prompts that spawn parallel and nested subagents. Check against the spec:
  - one room per session
  - spawn, handoff and exit animations
  - the task description on name tags
  - live tokens and a filled-in panel
  - "maybe stuck" after 180 s (temporarily set `stuckMs` lower to check)
  - needs-you on a permission prompt
  - `/clear` causing a shift change rather than a new room
  - the app started mid-session still showing the session via discovery
  
  Record any gaps as fixes before moving on.
- [ ] **Step 3:** Confirm that Claude Code is unaffected with the app quit: hooks don't delay prompts.
- [ ] **Step 4:** Write `README.md`: what it is, install (plugin + app), the demo, the config file, privacy (localhost only), and the known limit that the panel relies on internal logs.
- [ ] **Step 5:** Commit (`docs: README and e2e verification`).
