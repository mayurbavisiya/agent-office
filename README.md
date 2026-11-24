# Agent Office

Agent Office is a small floating desktop window that shows every running Claude Code session as a room in an animated cartoon office. Each room has a boss (the main agent) and flat-vector human characters (the subagents). Subagents walk in, sit at desks, carry their result to whoever spawned them, and walk out. There is also an optional Claude Code plugin that makes updates instant.

## Quick start

You need Node and npm. The project is developed on Node 26 and Electron 45.

```sh
npm install
npm approve-scripts electron   # a fresh install blocks install scripts until approved
npm approve-scripts esbuild
npm rebuild electron           # fetches the Electron binary if it is missing
npm run build
npm start
```

A second `npm start` does not open another copy. It brings the existing window forward.

Start a Claude Code session and a room appears. The app finds sessions on its own (see below), so the plugin is optional.

## The plugin

The plugin is optional but recommended.

- **Without it**, the app still finds every running session and subagent. It rescans Claude Code's session registry (`~/.claude/sessions/*.json`, or `$CLAUDE_CONFIG_DIR`) every 3 seconds.
- **With it**, events arrive instantly through Claude Code hooks, and permission prompts show the "needs you" pose.

Install it by typing these inside Claude Code:

```
/plugin marketplace add <path-to-repo>
/plugin install agent-office
```

Then restart your sessions so the hooks load.

The plugin only forwards hook events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `Notification`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`) to the app with `plugin/scripts/forward.sh`. The hooks are `async: true` and the script uses `curl --max-time 1`. With the app quit, a hook run took about 14 ms, exited 0 and printed nothing, so Claude Code is unaffected.

## Using the window

- Click a character to open a panel with tokens, estimated cost, context window, tools, files and recent activity.
- Click a room to zoom into it.
- Use the menu-bar tray icon to show or hide the window, set opacity (30%, 50%, 75% or 100%), switch to a compact strip, toggle always-on-top, toggle launch at login, or quit.
- Closing the window only hides it. The app keeps running in the tray until you choose Quit.

## Demo mode

To see the office without real sessions, start the app and run:

```sh
npm run demo -- --sessions 3
```

It replays recorded hook events as fake sessions until you press Ctrl-C. Other flags are `--speed <n>` (for example `--speed 2`), and `--port` and `--token` if you are not using the default config.

## Configuration

Everything lives in `~/.agent-office/` (override the folder with the `AGENT_OFFICE_DIR` environment variable).

- `config.json` holds the server port (default 47821) and a random token. It is created on first run with mode 0600. If the port is taken, edit it here.
- `window.json` remembers the window position, size, opacity, always-on-top and compact settings.

## Privacy

Everything stays on your machine and nothing is sent anywhere. The local server binds to 127.0.0.1 only. The hook event endpoint and the live connection the office window uses both require the token from `config.json` (the plugin sends it in a header, never on the command line); the office page's static files are served without it. The `.key` files in the session registry are never read.

## Known limits

- The panel details and session discovery rely on Claude Code's internal, undocumented files (the logs under `projects/` and the session registry). A Claude Code update could change them. Hooks keep working, but some details might go blank.
- Cost is an estimate.
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
