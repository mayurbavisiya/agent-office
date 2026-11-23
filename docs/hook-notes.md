# Hook notes (recorded against Claude Code 2.1.328, 2026-11-23)

Recorded headless (`claude -p ... --plugin-dir ./plugin --model haiku`) in a scratch folder.
Fixtures: `tests/fixtures/hooks/*.jsonl` (one hook payload per line, sanitized paths) and
`tests/fixtures/logs/<scenario>/` (sanitized copy of `~/.claude/projects/<slug>/`; main log
`<sid>.jsonl`, subagents in `<sid>/subagents/agent-<id>.jsonl` + `.meta.json`).
Paths: `/scratch/ao` = cwd, `/home/user` = home. Session ids/agent ids are real.

## 1. Agent tool name and `tool_input` fields

`tool_name` is **`Agent`** (not `Task`). Keys of `tool_input`: `description`, `prompt`,
`subagent_type`, `run_in_background` (the last two optional; `model` and `name` appear when the model
sets them). Name-tag text = `tool_input.description`.

`single-subagent.jsonl`:
```
{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"List files in ao folder","prompt":"List the files ...","subagent_type":"Explore","run_in_background":false},"tool_use_id":"toolu_017vHtXUyMcZpErpSwmsvLmW", ...}
```
Hooks also fire for an internal tool `SubagentHandback` (used by subagents to return their report):
ignore it for tool activity. After a subagent finishes, the parent receives a synthetic
`UserPromptSubmit` whose prompt starts with `<agent-message from="<agent_id>">` (so UserPromptSubmit is
NOT always a human prompt; do not treat it as the user starting a task).

## 2. Parent `tool_use_id` vs child `agent_id`

- `SubagentStart` carries only `agent_id` and `agent_type` (no tool_use_id, no description).
  `{"agent_id":"a1c6ea8b5593d9948","agent_type":"Explore","hook_event_name":"SubagentStart"}`
- Link, in order of reliability:
  1. `PostToolUse` of the `Agent` tool: `tool_response.agentId` == child `agent_id`, same `tool_use_id`
     as the PreToolUse. For foreground runs this arrives only AFTER the child finishes
     (`tool_response` keys: status, agentId, agentType, content, usage, totalTokens, ...). For
     background runs it arrives immediately: `{"isAsync":true,"status":"async_launched","agentId":"a22a3e7a7ad2a9925",...}`.
  2. Child's `agent-<id>.meta.json` on disk: `"toolUseId":"toolu_017v..."`, `description`, `agentType`,
     `spawnDepth`, `requestShape` (`foreground`/`background`), and `parentAgentId` for nested ones.
  3. Ordering heuristic (live, before 1/2 are available): the PreToolUse(Agent) events precede their
     SubagentStart events. Parallel case: 2 PreToolUse(Agent) then 2 SubagentStart, in the same order
     in the fixture, but do not rely on it; match the child's meta.json (may lag the start slightly) or
     pair via `prompt_id` + description order.
- All events of one user turn share `prompt_id`.

## 3. Nested SubagentStart and the parent

A nested `SubagentStart` does NOT carry the parent's id: it looks identical to a top-level one
(`nested-subagent.jsonl`: `{"agent_id":"a77d3c6b5b7d26195","agent_type":"Explore","hook_event_name":"SubagentStart"}`).
The parent is identifiable from:
- the `PreToolUse` (and `PostToolUse`) of the `Agent` tool fired INSIDE the parent subagent, which
  has `agent_id` = parent: `{"agent_id":"a9f22c4a50884571c","agent_type":"general-purpose","hook_event_name":"PreToolUse","tool_name":"Agent",...,"tool_use_id":"toolu_01EpcGxktHBWeXedkF2WLtDu"}`; the child's meta.json then has that `toolUseId`;
- child `meta.json`: `"parentAgentId":"a9f22c4a50884571c","spawnDepth":2`.
So: build `tool_use_id -> parent agent_id` from PreToolUse(Agent) events (agent_id absent = main
session), then resolve each child via PostToolUse.agentId or meta.json.toolUseId.
Subagents CAN spawn subagents (max_depth 2 observed). When the main agent's Agent call is made
without `run_in_background`, Claude Code may still auto-background it (`status: async_launched`,
meta `requestShape:"background"`) - seen in the nested run.

## 4. Teammates and their lead

Not captured as a true team. In headless `-p` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` there was no
TeamCreate tool, and the model fell back to an ordinary `Agent` call with `name:"helper"` (see
`named-agent.jsonl`; `tool_input` keys: description, prompt, model, run_in_background, name). The
subagent behaves like a normal one (SubagentStart/Stop with agent_id; meta.json has `"name":"helper"`),
and the parent gets `<agent-message from="helper">`. Linking a real teammate to a lead is therefore
UNVERIFIED; plan: treat named agents as ordinary children (the `name` is a good label), and verify
real agent-team events in the final end-to-end task in an interactive session.

## 5. `SessionStart.source`

Captured (`clear-resume.jsonl`, via headless `--resume <id>` and `--continue`): same `session_id`, and
```
{"hook_event_name":"SessionStart","source":"resume","seconds_since_last_response":4,"context_tokens":24804,"prompt_cache_likely_expired":false,"estimated_cache_write_usd":0.005}
```
Fresh: `"source":"startup"`. Each headless run ends with `SessionEnd` `"reason":"other"`, so a resumed
session sees SessionEnd then SessionStart(resume) with the same session_id; the session must be
revived, not duplicated.
**`/clear` NOT captured** (interactive-only; docs say `source:"clear"`, expected to come with a NEW
`session_id` and a SessionEnd `reason:"clear"` for the old one). To be verified in the final end-to-end task.

## 6. Real event order

Single foreground subagent (`single-subagent.jsonl`):
```
SessionStart(startup) -> UserPromptSubmit -> PreToolUse(Agent, main) -> SubagentStart
 -> [PreToolUse/PostToolUse of child tools, agent_id set]* -> PreToolUse/PostToolUse(SubagentHandback)
 -> SubagentStop -> PostToolUse(Agent, main, tool_response.agentId)
 -> UserPromptSubmit(<agent-message from=..>) -> Stop -> SessionEnd(other)
```
Parallel: both PreToolUse(Agent) first, both SubagentStart, interleaved child events, each SubagentStop
followed by its PostToolUse(Agent). Background/auto-async: `PostToolUse(Agent, async_launched)` fires
immediately, then `Stop` for the main agent fires while the child is still running
(`Stop.background_tasks` lists it: `[{"id":"a22a...","type":"subagent","status":"running","description":...,"agent_type":"general-purpose"}]`);
the child finishes later (SubagentStop; its `background_tasks` still lists itself as running), then a
synthetic `UserPromptSubmit` hand-back and a second `Stop` (empty `background_tasks`).
=> `Stop` does NOT mean all work is done; check `background_tasks`.

## 7. Other facts

- Common fields on every event: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`;
  most also `permission_mode`, `effort:{level}`. Events inside a subagent add `agent_id`, `agent_type`.
- `SubagentStop`: `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `background_tasks`
  (spec said also `last_assistant_message`: not present in these runs). `Stop` has `last_assistant_message`.
- `PostToolUse` also has `tool_response` and `duration_ms`.
- `Notification`: NOT captured (no permission prompts in headless allow-listed runs); verify later.
- Hooks work from the plugin with `async:true`; forward.sh delivered all events with `--max-time 1`.
- `--dangerously-skip-permissions` was refused by this environment's classifier; runs used
  `--allowedTools "Agent Read Glob Grep LS"` instead.

## 8. Log format facts (for the log reader)

- Line `type`s in main logs: user, assistant, system, attachment, queue-operation, api-request(+blob/shape),
  last-prompt, session-owner, atis-latch, tools-used, cost-state. Fixtures drop api-request*, session-owner,
  atis-latch, queue-operation and redact attachment/system-reminder contents (personal data); unknown
  types must be tolerated.
- One API message is written as SEVERAL assistant lines (one per content block: thinking, text, tool_use)
  that share the same `message.id` and an identical `message.usage`. Dedupe by `message.id` when
  summing tokens, or tokens are overcounted.
- `message.model` (e.g. `claude-haiku-5-5`) and `message.usage` have `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens` (plus `iterations`, nested `cache_creation`).
- Main log contains the `tool_use` block for `Agent` (`name":"Agent","input":{description,subagent_type,prompt,run_in_background}`,
  `id` = hook `tool_use_id`).
- Subagent logs have `isSidechain: true`; their meta.json fields are listed in section 2.
