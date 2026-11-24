# Decisions made during the build (agent-office + human characters)

Taken by the build controller on the person's behalf; each line ends with what it costs if wrong.

- Ruling (Task 2 scope add): shrink DESK_BOTTOM to fit new furniture, and let character scale grow when the room has space (cap so tags fit) — controller saw tiny people in big rooms — cost if wrong: layout tweak
- Ruling: work on branch feat/agent-office in place, no worktree — brand-new repo with only docs on main, nothing to isolate from — cost if wrong: none, branch can be moved.
- | T1 self | creates .gitignore; already created at setup | Ruling: T1 keeps existing .gitignore, adds only missing entries |
- | T1 self | Step 5 asks person to run /clear + resume interactively | Ruling: implementer tries headless `claude -p --resume/--continue` to capture resume; /clear capture deferred to T13 if impossible; store shift-change uses SessionStart.source per hooks docs — cost if wrong: T4 shift-change rule adjusted in T13 |
- | T3 self | pricing values "from pricing page" | Ruling: fill only values the implementer can confirm from official docs; others omitted → null cost "—" |
- | T12 self | compact mode "?compact=1 or WS message" | Ruling: query param `?compact=1` with window reload — simplest, one path |
- Ruling: implementer's denied --dangerously-skip-permissions was correctly not retried; --allowedTools used — no action.
- Ruling: teammate→lead link deferred to T13 alongside /clear and Notification — not capturable headless — cost if wrong: T4 teammate rule may need adjusting in T13.
- Task 3: dispatched (base 921c9a5, implementer sonnet). Ruling: LogDelta gains messageId; usage deduped per message.id per hook-notes — cost if wrong: token counts inflated
- Ruling: handing_off→gone after ≥6000ms via tick; gone pruned from snapshot after 60s — plan left durations open; animator needs time to play — cost if wrong: timing tweak
- Ruling: needs_you only for permission/input notifications — spec: "asked for permission or input" — cost if wrong: boss raises hand too often/rarely
- Ruling: needs_you = permission prompts + elicitation/input dialogs only; idle_prompt is the idle state — spec: idle = waiting for the user, sleeping boss — cost if wrong: boss sleeps when user input is actually needed
- Ruling: T5 adds optional `gitBranch?`/`cwd?` to LogDelta (from top-level log fields) so T6 can set session.branch — spec room sign shows branch; hooks never carry it — cost if wrong: branch missing on signs
- Ruling: T6 may extend store.applyLog to set session.branch/cwd from delta.gitBranch/cwd (with a store test) — store owns Session; T5 delivered the fields — cost if wrong: small refactor
- Ruling: discovered sessions seeded via synthetic SessionStart {source:'discovered', cwd} then logs watched fromStart — store creates rooms only via hooks API — cost if wrong: discovered room boss state starts idle
- Ruling: keep watching ended sessions until pruned from snapshot; no EOF re-arm — polling cost trivial vs lost stats — cost if wrong: slight extra polling
- Task 9: dispatched (base cae4ab4, implementer opus — visual port + diff rendering). Ruling: per-room/per-character keyed diff rendering (no full rebuild) — full rebuild restarts CSS animations every second — cost if wrong: more scene code
- Ruling: controller performs visual check via Chrome after T9 (implementer cannot see screen)
- Controller finding (not T9 code): discovered sessions show ALL historical subagents as working (25 in this session's room) — discovery never marks finished subagents done → would all go "stuck" after 180s. Ruling: add fix task 6b after T9 review — at discovery/replay, a subagent whose meta.json toolUseId has a matching tool_result in the main log (or equivalent completion marker per hook-notes §8) is treated as finished (not shown) — cost if wrong: crowded rooms of ghost agents.
- Controller finding (T10 scope): ended rooms stay on the floor at 0.75 opacity for LINGER_MS=60s after fade_out_room → demo shows 10 rooms for 2 live sessions; active rooms shrink. Ruling: after fade_out_room finishes, the renderer removes the ended room from floor layout (keep it out until pruned or revived) — spec "ended: room fades out" — cost if wrong: rooms vanish a bit sooner.
- Ruling: new agents with parentId take free slot nearest parent (grid distance, ties lower index); top-level first free — spec "cluster around parent" binds over ruling-1 wording — cost if wrong: small seat-pick change
- Task 10: fix round 2/5 (1 addressed as specified; commits 3080d47..676ca92). Re-reviewer's "residual" (room on screen + session ended during WS disconnect → no fade, lingers till prune) is pre-existing, not fix breakage → deferred minor. Ruling: sessions that start+end within one event batch get no room — sub-batch sessions are near-instant; showing a flash then hiding adds no monitoring value — cost if wrong: a missed micro-animation.
- Task 11: dispatched (base 676ca92, implementer sonnet). Rulings: panel.ts owns single formatTokens (looks re-uses); panel = right overlay card 300px (full width <520px) — floating window too small for fixed column — cost if wrong: layout tweak
- Ruling: "—" only when model undefined AND all counts 0; same rule on name tag — brief: undefined→"—", real 0 must show — cost if wrong: cosmetic
- Ruling: spawned = max(live agents, boss.tools.Agent); done = spawned-running-stuck ≥0 — finished subagents excluded at discovery (6b) — cost if wrong: approximate team count
- Ruling: applyLog lowers startedAt to earliest log timestamp — discovery time misleads running-time stat — cost if wrong: none
- Task 12: dispatched (base 1f94b03, implementer sonnet). Rulings: compact via ?compact=1 reload; drag bar + transparent bg only with ?shell=electron; preload sandboxed; dock hidden; single-instance; AGENT_OFFICE_DIR override for testing — cost if wrong: small UI rework
- Ruling: use ~/.claude/sessions/<pid>.json registry (live pid) as session source + 3 s rescan for sessions/subagents/clear; mtime scan only as fallback — spec "all active sessions"; registry is internal like logs (risk already accepted) — cost if wrong: format changes break discovery (fallback remains)
- Ruling: room label shows session name (Warp/claude tab name) — matches what the person sees in their terminal — cost: cosmetic
- Ruling: an existing-but-empty sessions dir = no running sessions (no mtime fallback) — registry is authoritative when present — cost if wrong: zero rooms on an unusual setup
- Ruling: unpackaged launch-at-login shown disabled ("packaged app only") — dev path registration would open bare Electron — cost: feature unavailable from source until Plan 2
- Ruling (parked): two sessions in one cwd + plugin + Start(clear) before End(clear) → new room instead of shift change (no room stolen) — safe failure; fix = retroactive merge on End(clear)/rescan — cost: a cleared room jumps to floor end in that rare case
- Ruling (parked): M1 client connecting inside the 50 ms window may replay animations — cosmetic, rare — cost: one duplicate walk-in on (re)connect
- Ruling (parked): registrySeen needs a live entry; dir-vanishes-before-any-live-session edge falls back to mtime — very rare — cost: recently exited sessions shown briefly

## Office plugin (plan 2026-11-24-office-plugin) — rulings
- /office stop uses POST /shutdown, honoured only for plugin-started trackers (409 otherwise). If wrong: stop needs another mechanism.
- Version restart only for plugin-started trackers. If wrong: an app tracker stays on an old version until the app restarts.
- "Desktop app installed" = /Applications/Agent Office.app exists. If wrong: the "open the app instead" line shows/hides wrongly.
- Fixed Task 2 review minors early (bounded waits, restart fallback, wx config create). If wrong: slightly more change before the panel.
- Panel frame state in module variables; snapshot/selection/reachability in atoms; timers start only when the panel opens. If wrong: small refactor.
- Task 4 re-review done by the controller (4-line README wording fix, checked by grep). If wrong: a wording slip in the README.
- One fix wave for all final-review findings. If wrong: more change before the live test.
- Left as "can wait": panel recovery after 30 s hidden relies on a redraw; a stale selection can return; pixels.ts is 709 lines; an untracked first poll timer; rare first-run config race with a half-written file; the launcher-failure message on non-terminal surfaces. If wrong: cosmetic glitches.
- Incident: a builder's demo run sent ~3 s of fake events to the live app on 47821 (demo ignored AGENT_OFFICE_DIR). Fixed in tools/demo.ts.
