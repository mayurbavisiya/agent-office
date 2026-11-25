# Agent Office

Agent Office shows every running Claude Code session as a room in a small pixel office. Each room has a boss (the main agent) and pixel people (the subagents). It runs as a Claude Code plugin, and there is an optional desktop app too.

## Quick start

1. Install the plugin. Type this inside Claude Code:

   ```
   /plugin install agent-office --marketplace mayurbavisiya/agent-office
   ```

   Type `y` to add the marketplace, then pick a scope. Or, from a shell:

   ```sh
   claude plugin install agent-office --marketplace mayurbavisiya/agent-office
   ```

2. Restart Claude Code, then type `/office`.

A panel opens beside the chat. You need Node 20 or newer on your PATH. Tested on macOS so far.

## What the panel shows

- One room per Claude Code session, with a pixel person for each agent.
- A usage bar across the top of the browser office: tokens and estimated cost across all your Claude Code sessions for today, this week (from Monday), this month, or a custom date range. "Details" opens a table with a row per day and per model (input, output, cache write, cache read, total, cost), like `ccusage`. The panel in Claude shows a "today" line.
- A visitor chair at the main agent's desk: it lights up amber with "your turn" when the session is waiting on you (a permission prompt, a question, or your reply). The browser tab title counts those rooms, e.g. "(2) Agent Office", and the panel in Claude marks them "▶ your turn".
- When a subagent finishes, it walks its work over to the lead and heads out the door. When the whole task is done, the lead stands up, the subagents that worked on it walk back in, and they all dance in the middle of the room under a disco ball.
- A subagent blocked on a permission prompt is flagged too: it raises its hand, its tag reads "waiting on you" in amber, and its details say its prompt is open. It never shows as "maybe stuck" while it waits. (The plugin registers Claude Code's `PermissionRequest` hook for this; it only watches, it never answers a prompt.)
- Slow is not stuck: an agent in the middle of a long tool call (a test run, a build) shows "⏳ running Bash · 4:12" in blue and is not flagged. "Maybe stuck" means 3 minutes with no activity and no tool call under way (or one tool call running for over 20 minutes).
- An agent that keeps making the same tool call with the same input (3 times in a row) gets a red ↻ and "looping? Read ×4". Tools meant to be polled, like `TaskOutput`, are left out.
- Name chips under the rooms. Press a chip to open that agent's details (type, task, status, tokens, estimated cost, running time and last activity). Press close to go back.
- "+N more" in the room view when there are more rooms than fit, and "+N" at the end of the chip row when there are more chips than fit.
- `/office` also prints the full office link. Open it in a browser to see the animated office.
- On the desktop app or VS Code, the panel is a text list of rooms and agents with their status, plus the chips.

Type `/office stop` to stop the tracker.

## The tracker

`/office` starts a small background tracker if none is running. It needs Node 20+. It exits on its own after 30 minutes with no busy session. Its log is `~/.agent-office/tracker.log`. If the desktop app is already running, `/office` uses it and leaves it alone.

With no tracker answering, the panel shows "office tracker not running — run /office". On a surface that cannot start processes, `/office` says to run it once in terminal Claude, or open the Agent Office app. If something that can't prove it knows the token holds the port (another program, or an older Agent Office app), `/office` sends it nothing and says to change the port or rebuild or quit that app; if the tracker on the port uses another token, it says so. If the desktop app finds a tracker that `/office` started on its port, it stops that tracker and takes the port over.

The plugin also forwards hook events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `Notification`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`) with `plugin/scripts/forward.sh`. The hooks are `async: true` and the script uses `curl --max-time 1`. With nothing listening, a hook run took about 14 ms, exited 0 and printed nothing, so Claude Code is unaffected. Without hooks, sessions are still found by rescanning `~/.claude/sessions/*.json` (or `$CLAUDE_CONFIG_DIR`) every 3 seconds.

## Desktop app (optional)

The desktop app is a floating window with the same office. You need Node and npm. The project is developed on Node 26 and Electron 45.

```sh
npm install
npm approve-scripts electron   # a fresh install blocks install scripts until approved
npm approve-scripts esbuild
npm rebuild electron           # fetches the Electron binary if it is missing
npm run build
npm start
```

A second `npm start` does not open another copy. It brings the existing window forward.

### Using the window

- Click a character to open a panel with tokens, estimated cost, context window, tools, files and recent activity.
- Click a room to zoom into it.
- Use the menu-bar tray icon to show or hide the window, set opacity (30%, 50%, 75% or 100%), switch to a compact strip, toggle always-on-top, toggle launch at login, or quit.
- Closing the window only hides it. The app keeps running in the tray until you choose Quit.

## Demo mode

To see the office without real sessions, start the app and run:

```sh
npm run demo -- --sessions 3
```

It replays recorded hook events as fake sessions until you press Ctrl-C. Other flags are `--speed <n>` (for example `--speed 2`), and `--port` and `--token` to override the config. It reads the config from `AGENT_OFFICE_DIR` (or `~/.agent-office`). Point it only at a tracker or app you started for this.

## Configuration

Everything lives in `~/.agent-office/` (override the folder with the `AGENT_OFFICE_DIR` environment variable).

- `config.json` holds the server port (default 47821) and a random token. It is created on first run with mode 0600. If the port is taken, edit it here.
- `window.json` remembers the window position, size, opacity, always-on-top and compact settings.
- `usage.json` keeps daily token and cost totals per model (no prompts or file names). Claude Code deletes its own logs after 30 days by default, so this file is what lets the usage bar show older ranges.

## Privacy

Everything stays on your machine and nothing is sent anywhere. The local server binds to 127.0.0.1 only. The hook event endpoint, the `/state` and `/usage` endpoints and the live connection the office window uses all require the token from `config.json` (the plugin sends it in a header, never on the command line); the office page's static files are served without it. The `.key` files in the session registry are never read.

- **Hook events only reach Agent Office's own tracker.** The hooks pass Claude Code's full hook payloads (prompts, tool inputs and outputs) to the tracker over loopback. The forwarder sends only while the tracker's `tracker.pid` names a live process of yours, so nothing goes to whatever else might be on the port while the office is off. It ignores `http_proxy`/`ALL_PROXY` and `~/.curlrc`, and never follows a redirect.
- **The `/office` link never contains the token.** It carries a one-time ticket that works once, within 2 minutes. Opening it trades the ticket for a read-only key that only that browser tab keeps (it can watch the office but not send events or stop the tracker) and removes the ticket from the address bar. The copy left in the transcript is useless after that. After a tracker restart, open a fresh link with `/office`. The `/office` reply is shown to you only, so `/office` uses no tokens.
- **The token is only sent to a tracker that proves it knows it.** Before sending the token, the plugin and the desktop app ask whatever holds the port to prove (with a hash of the token and a fresh random value) that it knows the token. Their requests never follow redirects.

## Known limits

- The panel details and session discovery rely on Claude Code's internal, undocumented files (the logs under `projects/` and the session registry). A Claude Code update could change them. Hooks keep working, but some details might go blank.
- Cost is an estimate, not a bill: it uses Anthropic's API prices (5-minute and 1-hour cache writes priced separately). On a Pro or Max plan you pay a flat subscription, so read it as what the same usage would cost pay-per-token. Tokens from a model without a price are counted but left out of the cost.
- Usage history starts with what Claude Code's logs still hold (30 days by default) and grows from there.
- The tracker needs Node 20+. Without it, `/office` cannot start one.
- A signed, notarized app with auto-update is planned. For now you run it from source.

## Development

```sh
npm test            # vitest run
npm run build       # type-check, then bundle the scene and the Electron main process
npm run build:scene # bundle only the scene
npm run build:main  # bundle only the Electron main process
npm run serve       # run the server alone and print a browser URL with the token
npm run demo        # fake sessions (see Demo mode)
```

Set `AGENT_OFFICE_DEBUG=1` to log to stdout. Toolchain notes are in `docs/dev-notes.md`, and notes on Claude Code's hooks, logs and session registry are in `docs/hook-notes.md`.

## License

MIT. See [LICENSE](LICENSE).
