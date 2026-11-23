# Agent Office: Design

Date: 2026-11-23
Status: draft, awaiting approval (builder check done)

## Intent and why

When Claude Code works with subagents, the person running it can't easily see who is doing what. This project shows every agent as a cartoon character in a small **floating office window** on the desktop. The window covers **every active Claude Code session** at once. The main agent is the "boss" of each session, and subagents are its team. They appear when they're spawned, work at desks, and walk to the boss with an animation when they finish and hand their result back.

The person wants two things, weighted equally:

1. **Monitoring at a glance.** Which sessions are active, which agents are running, what each was asked to do, how long it's taking, how many tokens it has used, and which ones look stuck.
2. **Fun to watch.** Characters with personality and plenty of small animations. Starting, finishing and handing off should feel like little events, not status changes.

## Goals

- A Claude Code **plugin** whose hooks report agent and session activity to a local desktop app, for the terminal, IDE extensions and the desktop app alike.
- An **Electron desktop app** with a frameless, always-on-top floating window that shows an animated office.
- **One room per active session** on a single floor, labeled with the session's project folder name. Each room has a boss character for the main agent and team characters for its subagents.
- **Animated life cycle:** spawn (door opens, sparkle, walks to a desk), working (typing, code scrolling on a monitor), quiet or stuck (head-scratching, sweat, red timer), handoff (walks to the boss, hands over a report, boss celebrates with confetti), leaving (walks out the door).
- **Click a character → info panel** with: name and type, task description, status, model, input/output/cache-read/cache-write tokens, running time and start time, estimated cost, how full its context window is, tool-call counts by tool, files touched and a recent-activity list. The boss's panel also shows team totals (number spawned, done, stuck). Token counters under name tags update live.
- **Click a room → zoom** into that session at full size. Click again or press Esc to go back to the floor.
- The office scene is built as a **web page**, so phase 2 (the same office in a browser tab) needs no rewrite.
- **Installable by other people**, not just this Mac (decided by the person):
  - signed and notarized macOS build, so macOS doesn't block it. This needs an Apple Developer account (paid yearly), which the person will have to provide when it's time to sign.
  - auto-update (for example electron-updater with GitHub Releases)
  - the plugin published in a public plugin marketplace (a GitHub repo), installable with `/plugin`
  - first-run setup: the app writes its config and checks that the plugin is installed. If the plugin is installed first and the app isn't running, nothing breaks.
  - respects `CLAUDE_CONFIG_DIR` when locating logs, instead of assuming `~/.claude`
  - tolerates different Claude Code versions (see "Dependency on internal logs")

## Non-goals (this phase)

- Controlling agents from the window (stopping, steering or messaging them). It is view-only.
- The browser version. That's phase 2, but the architecture must allow it (see Architecture).
- Cloud / remote sessions. Only sessions running on this machine.
- Exact billing. Cost is an estimate derived from token counts.
- Windows/Linux builds in the first release. macOS ships first; Electron keeps the door open and the code should avoid Mac-only APIs where it can (Claude's call).

## Anti-goals (failure even if it "works")

- **Slowing Claude Code down or breaking a session.** Hooks must never block. If the app isn't running, hooks fail silently and instantly.
- **Data leaving the machine.** Everything stays on localhost. No telemetry and no external requests.
- **So busy or distracting that it gets turned off.** Animations should be lively but not frantic. The window can be shrunk, made see-through or hidden.

## Constraints and verified facts

From the Claude Code hooks docs (code.claude.com/docs/en/hooks.md), checked on 2026-11-23 against Claude Code 2.1.328:

- Plugin hooks fire in the terminal, IDE extensions and the desktop app.
- Every event includes `session_id`, `transcript_path`, `cwd` and `hook_event_name`. Events fired inside a subagent also include `agent_id` and `agent_type`.
- Relevant events and the extra fields they carry:
  - `SessionStart`: `source`, optional `model`, optional `session_title`.
  - `SessionEnd`: `reason`. The default hook timeout here is only 1.5 s, so this hook must be fast.
  - `UserPromptSubmit`: common fields only.
  - `Stop`: `last_assistant_message`.
  - `SubagentStart`: `agent_id`, `agent_type`. There is no task description or transcript path.
  - `SubagentStop`: `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`.
  - `PreToolUse` / `PostToolUse`: `tool_name`, `tool_input`, `tool_use_id`. They also fire inside subagents, with `agent_id`.
  - `Notification`: `message`, `notification_type`. This includes "Claude needs your permission".
- `async: true` is available only on **command** hooks, which then run in the background without blocking. HTTP hooks have no async option. → Use async command hooks.
- Logs on disk (confirmed on this machine):
  - Main session: `~/.claude/projects/<project-slug>/<session-id>.jsonl`
  - Subagents: `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.jsonl` plus `agent-<agentId>.meta.json`
  - Assistant lines include `message.model` and `message.usage` with `input_tokens`, `output_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`.
  - **The log format is internal and undocumented and may change between Claude Code versions.**
- **Unverified:** the field names in `tool_input` for the Agent tool (expected `description`, `prompt` and `subagent_type`), and whether the matcher is `Agent` or `Task`. The task description shown on name tags depends on this.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | **Electron**, with the office as a web page | Reuses the mockup almost as-is. Phase-2 browser version is nearly free. Fastest to iterate on the animations. Costs a large app (~150 MB) and more memory. |
| B | Tauri, with the same web page | Small (~10 MB) and light. Needs the Rust toolchain, and transparency and always-on-top take more work. Slower to build. Can be adopted later without redrawing the scene. |
| C | Native Swift / SpriteKit | Smoothest and most Mac-native. Mac-only, the scene would be redrawn from scratch, and the browser version would be a separate project. |

**Chosen: A.** The person plans "floating window now, browser later". Electron makes the second step nearly free and gets the office on screen fastest.

**Multi-session layout considered:** (1) one floor with a room per session (**chosen**), (2) tabs with one office per session, (3) one shared open-plan office. Option 1 keeps every session visible at a glance in a small window. Clicking a room to zoom brings in the best part of option 2.

**Display mode considered:** characters walking freely over the desktop like a desktop pet, versus a floating office window. **Chosen: the floating office window.** The office needs a backdrop.

## Decided by the person

- Floating office window (not free-roaming desktop pets, at least for now). The browser version comes later.
- An office setting, with lots of animation and characters with personality.
- Clicking a character shows tokens and as much other detail as possible.
- Electron (approach A).
- All active sessions are shown, one room per session on a single floor.
- It's for other people to install as well, not just this Mac.

## Architecture (Claude's proposal)

```
Claude Code session(s)                          Agent Office app (Electron)
┌───────────────────────┐   async command hook   ┌──────────────────────────────────┐
│ plugin hooks.json     │ ── curl POST ────────▶ │ main process                     │
│  SessionStart/End     │   127.0.0.1:<port>     │  • event server (HTTP + WebSocket)│
│  UserPromptSubmit     │                        │  • log watcher (tails .jsonl)    │
│  Stop, Notification   │                        │  • session/agent state store     │
│  SubagentStart/Stop   │                        └──────────────┬───────────────────┘
│  Pre/PostToolUse      │                                       │ WebSocket: state + events
└───────────────────────┘                                       ▼
~/.claude/projects/**.jsonl  ◀── read-only tail ──   office scene (web page, SVG + CSS)
                                                     • Electron window now
                                                     • any browser tab in phase 2
```

### 1. Plugin (`agent-office` Claude Code plugin)

- `hooks/hooks.json` registers **async command hooks** for: SessionStart, SessionEnd, UserPromptSubmit, Stop, Notification, SubagentStart, SubagentStop, PreToolUse and PostToolUse (all tools).
- One small script forwards the hook's stdin JSON to `http://127.0.0.1:<port>/event` using curl with a ~1 s max time. Any failure is ignored and the script exits 0.
- Port plus a shared secret token come from `~/.agent-office/config.json`, which the app writes on first launch. The hook sends the token in a header. The app rejects events without it, so other local processes can't inject fake events.
- No dependencies beyond `curl` and a POSIX shell. The plugin is self-contained and can be installed through a local plugin marketplace.

### 2. App main process

- **Event server:** a local HTTP endpoint for hook events and a WebSocket that pushes state to the scene. It binds to 127.0.0.1 only.
- **Log watcher:** for each known session, tails the main log and each subagent log, then extracts per agent:
  - model and token usage (summed across messages)
  - tool calls by name and files touched (from Read/Edit/Write/Grep/Glob inputs)
  - a recent-activity list
  - timestamp of the last activity
  - an estimate of how full the context window is: the latest input + cache tokens divided by the model's context size
- Parsing is defensive. Unknown line shapes are skipped. If fields are missing, the panel shows "—" rather than breaking.
- **Discovery at launch:** scan `~/.claude/projects` for logs modified in the last 10 minutes. These sessions are shown as active even though no hook events have arrived for them yet. If the app starts after sessions began, they still appear.
- **State store:** sessions → main agent + subagents, keyed by `session_id` and `agent_id`.
  - The Agent tool's `tool_use_id` (from PreToolUse) links to the subagent that SubagentStart then reports. This gives the subagent its task description.
  - The exact matching rule depends on what the logging spike shows (see Unknowns).

### 3. Session and agent states

- **Session:**
  - *active*: has had events or log writes in the last 10 minutes
  - *idle*: the main agent stopped and is waiting for the user (after Stop)
  - *needs you*: a Notification asked for permission or input. Shown as the boss raising a hand with a "!" bubble.
  - *ended*: after SessionEnd, or after 30 min without activity. The room fades out.
- **Subagent:**
  - *spawning*: SubagentStart received
  - *working*
  - *quiet / maybe stuck*: no tool call or log write for 3 minutes (configurable). The red timer counts up.
  - *handing off*: SubagentStop received, and the walk-to-boss animation plays
  - *gone*
- **Main agent:** *thinking/working* (after UserPromptSubmit), *delegating* (has running subagents), *idle*, *needs you*.

### 4. Office scene (web page)

- Starts from the approved mockup (`.superpowers/brainstorm/.../office-v2.html`):
  - SVG + CSS animations
  - blob-style characters with faces, blinking, typing arms and walk cycles
  - name tags with live token counters
  - desks with scrolling monitors (a red screen when stuck)
  - door, window with clouds, clock, whiteboard
- **Floor layout:** one room per active session in a grid. Each room's sign shows the project folder name and git branch. Rooms get smaller as sessions are added. Idle rooms dim, with a sleeping boss and "zzz". There is a sensible maximum of visible rooms, with the floor scrolling beyond that.
- **Characters:**
  - Each agent type always gets the same color and accessory (Explore: headphones; Plan: notepad; code-reviewer: glasses; and so on).
  - Unknown types get a color derived from a hash of the type name.
  - The boss wears a crown.
  - Name tags show the agent type plus a short task description when known.
- **Interactions:** click a character to open the info panel. Click a room to zoom in, and press Esc to return to the floor.
- Animation timing is driven by state changes. It is not a fixed loop.

### 5. Window

- Frameless, transparent background, always on top. Resizable and draggable by the floor's top edge.
- Tray/menu-bar icon with:
  - show/hide
  - opacity slider
  - compact strip mode, which shows just the rooms' bosses and counts
  - always-on-top toggle
  - launch at login
  - quit
- Remembers its size, position and opacity.

## Claude's calls (check these while reading)

- **Nested subagents:** agents form a tree, not a flat list. A subagent's own helpers sit near it and walk to *it* when they finish. Nesting is shown visually only one level deep: deeper helpers cluster around their parent.
- **Background agents:** a room stays lit while any agent in it is working. The boss only sleeps when the main agent has stopped *and* no agents are running. If agents are still going after Stop, the boss shows as "waiting on team".
- **Agent-team teammates:** if a teammate can be linked to its lead (same project folder and a lead/teammate signal from hooks or logs), it appears as a character in the lead's room. Otherwise it gets its own room. Settle this during the logging spike.
- **Session identity:** rooms are keyed by `session_id`.
  - A `SessionStart` with source `clear`, `resume` or `compact` in the same folder as a room that just went quiet takes over that room, with a short "shift change" animation. It does not create a new room.
  - Two live sessions in the same folder get separate rooms. Each room's sign adds the session title, or the short session id if there is no title.
- **Launch-time discovery:** show only sessions whose log was written in the last 10 minutes *and* that have no SessionEnd recorded. Stale ones never appear.
- **Mac first:** Windows/Linux builds come later.
- **Dependency on internal logs:** the person asked for "as much information as we can", so the info panel reads Claude Code's internal logs despite the risk (the person can overrule this):
  - the parser is isolated in one module with recorded fixtures for each tested Claude Code version
  - unknown lines are skipped
  - missing fields show "—", and the office and animations never depend on log parsing
  - hook-provided data (status, task, time, tool counts) always works on its own

## Left to the builder

- Port number, config file details, and how the plugin is packaged and installed (a local marketplace is recommended).
- Exact log-parsing code and token-to-cost price table (keep it in one editable file).
- Character art details, extra idle animations (coffee runs, water cooler chats), and sound (off by default if added).
- Test approach. Recommended: unit tests for the state store and log parser using recorded hook events and log samples, plus a "demo mode" that replays recorded events so the office can be worked on without live sessions.

## Unknowns to settle first

1. **Logging spike (first task):** install a hook that dumps raw stdin for every event, run a session that spawns a few subagents, and record:
   - the Agent tool's `tool_name` and `tool_input` fields
   - how its `tool_use_id` relates to the `agent_id` that SubagentStart reports
   - the real event order
   
   Save these as test fixtures.
2. How accurate the context-window figure is for each model. If it's unreliable, the bar can be dropped.
