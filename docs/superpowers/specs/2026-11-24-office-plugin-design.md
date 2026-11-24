# Agent Office as a Claude plugin: pixel panel + `/office`

**Status:** approved by the person on 2026-11-24 ("go go go").
**Builds on:** `2026-11-23-agent-office-design.md` (tracker, scene, desktop app) and `2026-11-24-human-characters-design.md`. Anything not mentioned here is unchanged.

## Intent and why
The person wants Agent Office to be "easy to use": nobody should clone the repo or run `npm start`. You install one Claude plugin, type `/office`, and the office appears inside Claude, next to the chat, while you work. The fuller office with the human characters stays one step away. The original goals still hold: monitoring plus fun to watch, every active session, and something you can share with others.

## What the person decided
- Option 2, "the office inside Claude", over a one-step installer for the desktop app.
- **Both**: a **pixel-art panel inside Claude** and **`/office`**, which also opens the full animated office.
- **No `npm start`.** A simple `/office` must start everything needed.
- Approach A (below): the panel reads from the existing tracker, which the plugin ships ready-built and starts itself. The person accepted Node.js as the one requirement, provided its absence is explained clearly.

## Goals
1. **One plugin to install.** It contains:
   - the existing hook forwarder (`plugin/hooks`, `forward.sh`)
   - a new hooks-module mod (the panel and `/office`)
   - a pre-built, self-contained tracker bundle: core, server and the built scene, bundled into the plugin as plain JS and assets. It has no `npm install` and no `node_modules` at runtime.
2. **`/office`** (registered with `$.command.register`) does the following, in order:
   1. Read `~/.agent-office/config.json` (respecting `AGENT_OFFICE_DIR`), or create it the way `loadOrCreateConfig` does.
   2. Check whether a tracker is already answering on that port with that token. It could be the desktop app, another session's panel, or an earlier `/office`. If one is, reuse it.
   3. If none is, start the bundled tracker headless as a detached background process with `node`. It must outlive the session that started it and must not exit when that Claude session ends.
   4. Open the pixel panel beside the chat (`$.ui.open`).
   5. Reply with a short text: the panel is open, plus a link to the full office (`http://127.0.0.1:<port>/?token=…`). The link opens in the browser when clicked. If the desktop app is installed (detect its install or app path), say it can be opened instead. Don't auto-launch anything outside Claude unless the person asks.
   6. If Node.js isn't found, say so plainly ("Agent Office needs Node.js 20+; install it from nodejs.org"). Don't crash or fail silently.
3. **The pixel panel**, a `Pane` drawn in the terminal with `Raster` cells (half-block glyphs give 2 vertical pixels per cell):
   - One small room per active session, in the same order as the floor (`floorSince`). The label is the session name, or the folder name if there is none.
   - Pixel-art boss and helpers in agent-type colours, placed at desks. Animation is driven locally at about 6–10 fps with `$.ui.blit`:
     - spawn: walk in from the door, then sit
     - handoff: walk to the boss holding a paper, then the boss bounces
     - exit: walk out
     - working: typing flicker
     - maybe stuck: a "z" over the helper
     - needs you: a blinking "!" on the boss
   - Under the rooms, a one-line status per room: boss state, helper count, and total tokens.
   - Click a character to show its details in the panel: name/type, task, status, tokens in/out/cache, estimated cost (labelled as an estimate), running time and the last activity. Click again, or press Esc, to close.
   - The panel gets its state by polling the tracker over localhost about once a second, with `$.http.fetch` and the token.
   - It lays itself out for the room it's given. It must stay legible at the minimum pane width the engine seats (about 40 columns). When there are many sessions, it shows as many rooms as fit, plus "+N more".
   - On a non-terminal surface (desktop app, VS Code), fall back to a text list of rooms and agents, or SVG where the surface has `Svg`. Terminal is the target.
4. **A new read-only state endpoint on the tracker**: `GET /state` returns the current `OfficeState` snapshot as JSON and requires the token (header). The scene's WebSocket stays as it is.
5. **The full office** is the existing scene with the human characters, served by the same tracker at `/`. Browser and desktop app work the same as today.

## Non-goals
- No signed or notarized desktop installer and no auto-update: that is still the later release plan.
- No new tracking logic. Discovery, logs, the store and `/clear` handling are reused unchanged.
- The pixel panel does not try to match the vector office-people art.

## Anti-goals
- Never slow down or disturb Claude:
  - hooks stay async and silent
  - panel polling and animation must not block the prompt
  - a missing or broken tracker shows a quiet message in the panel, never an error flood
- Never leak the token. It is not printed in the transcript except in the link the person asked for, and not in process arguments.
- Don't leave orphan trackers: if one already answers, never start a second.

## Constraints
- Everything stays local. The tracker binds to 127.0.0.1 and needs the token. The mod only talks to 127.0.0.1.
- The mod's hooks module has no Node and no DOM. It reaches the outside only through `$` (`$.fs`, `$.http.fetch`, `$.process.run`/`spawn`, `$.clock`, `$.ui.*`).
- The tracker bundle must run with plain `node <file>`. Electron isn't required for the panel or the browser view.
- The plugin must validate with `claude plugin validate` and pass `claude plugin test`.
- macOS first, matching the main spec.

## Approaches considered
- **A. The panel is a client of the bundled tracker (chosen).** It reuses the tested tracking code. `/office` starts the tracker, and the panel polls `/state`. Costs: Node.js is required, and there is one background process.
- B. Rebuild the tracking inside the mod with `$.fs`. No Node and no background process, but it duplicates about 2,000 lines of tested logic, the two copies drift, and `/office`'s full view still needs a server.
- C. A panel fed only by its own session's hook events. Rejected: it cannot show other sessions.

## Calls made after the builder check (Claude's calls; the person can overrule)
1. **Clicking a character.** A terminal `Raster` can't take clicks: it is a leaf with no `onPress`, and `Client` isn't available in the terminal. So under each room the panel shows a row of small name chips (`Button`s), one per character, labelled e.g. "boss", "Explore", "general-purpose". Clicking a chip opens that character's details in the panel, and a "close" chip closes them. Esc closes the whole pane, which is the engine's behaviour. That replaces "click the pixel character" and "Esc closes details" above. If more chips exist than fit, the extras collapse into "+N".
2. **Widths.** One responsive layout. Docked beside the chat (about 40+ columns, tall), rooms stack vertically. Inline above the prompt (full width, few rows), rooms sit side by side. The panel uses the rows it is given and shows "+N more" for rooms that don't fit. There is no hard minimum; below about 30 columns it shows a one-line summary instead of art.
3. **Surfaces.** The full feature, meaning starting the tracker and the pixel art, is for the terminal CLI. `$.process` is CLI-only and `Raster` is terminal-only. In the desktop app or VS Code, `/office` checks for a running tracker. If one answers, it shows a live text list of rooms and agents (SVG where cheap). If none does, it says to run `/office` once from the terminal, or open the desktop app.
4. **Port and token conflicts.** If the port answers but isn't a tracker, or rejects the token, `/office` doesn't start another tracker and doesn't rewrite `config.json`, because the desktop app and `forward.sh` share it. It says which port is taken and how to change it in `config.json`. Two `/office` runs at once are guarded by the tracker's own port bind: the second tracker fails to bind and exits quietly, and `/office` then re-checks and reuses the first. No lock file.
5. **Tracker lifecycle.**
   - Started through a small launcher script in the plugin, run by `$.process.run`. It starts `node <bundle>` detached (`nohup`-style) and returns immediately.
   - Logs go to `~/.agent-office/tracker.log`, capped (rotated at about 1 MB).
   - `/office stop` stops a tracker the plugin started.
   - `GET /state` (or a `/version` field) reports the tracker's version. If a plugin update has made it older than the bundle, `/office` restarts it, but only if the plugin started it, never the desktop app.
   - Idle exit: a plugin-started tracker exits by itself after 30 minutes with no live Claude sessions and no connected viewer. The desktop app's tracker is unaffected.
6. **Config creation.** The mod can't set file permissions, so the bundled tracker creates `config.json` (dir 0700, file 0600) on first start, as it does today. The mod only reads it. `/office` step 1 becomes "read if present", and the launch happens without needing the token. The mod waits briefly, about 3 s, for the file and the port to appear.
7. **Token in the link.** It is accepted. The person asked for the link. It is the only place the token appears in the transcript.
8. **Packaging.**
   - A new build target writes the tracker bundle (core + server + `ws`, one plain-JS file) and the built scene into the plugin folder.
   - These built files are committed, so installing from the repo (local folder or GitHub) needs no build step.
   - The existing `.claude-plugin/marketplace.json` entry is kept, and the README install steps stay `/plugin marketplace add …` then `/plugin install agent-office`.
   - The bundle must run under plain `node` with `ws`'s optional native add-ons absent. Verify this.

## Left to the builder
- Whether one plugin can hold both the classic `hooks` (`forward.sh`) and the hooks-module `modules`, or whether the mod should forward its own session's events itself (`$.http.fetch` from its event hooks) and replace `forward.sh` in the plugin. Pick whichever the engine supports. Keep the desktop app's hook path working.
- How the tracker is started detached from the session: `$.process.spawn` with detach, or a tiny launcher script started via `$.process.run` (`nohup`/`setsid`-style).
- The pixel sprites, the palette and the cell layout per room.
- How the panel animates between 1 s state polls. Diff successive snapshots into spawn, handoff and exit events, or reuse the store's event list if `/state` returns recent events.
- Whether `/office` also adds a status-line entry, e.g. "office: 3 sessions, 5 helpers working".
