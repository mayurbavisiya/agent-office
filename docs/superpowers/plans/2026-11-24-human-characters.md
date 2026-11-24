# Human Office Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blob characters with flat-vector office people who walk with a real walk cycle and sit on chairs.

**Architecture:** Each character becomes an SVG rig: a body group holding thigh/shin/arm groups with CSS transform-origins. CSS keyframes drive the limbs, toggled by state classes on the character's `g.char`. The Task 10 animator keeps owning position (the `g.anim` wrapper). It only adds and removes state classes and sets the facing direction. Furniture gains a chair per desk.

**Tech Stack:** TypeScript, SVG, CSS, esbuild, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-human-characters-design.md`. Reference rig, keyframes and furniture geometry: mockup option A at `.superpowers/brainstorm/25958-1795507439/content/humans.html`.

## Global Constraints
- Pure SVG + CSS. No new libraries, images or sprite sheets.
- Shirt colour = `looksFor(type).color`. Skin tone and hairstyle come from a stable hash of the agent id. The boss wears a dark suit and tie, with no crown, and keeps the "Main agent" tag.
- Name tags and status must stay at least as readable as today in a 720×420 window.
- Under `prefers-reduced-motion`, there is no walk cycle and no limb animation, and moves become 300 ms fades.
- Keep the Task 10 animator guarantees:
  - the end state is committed on stalled timelines
  - sticky seats
  - helpers sit near their parent
  - departing agents are kept until exit
  - ended rooms leave the floor
- Untrusted strings go into the DOM via textContent only.

## Review Focus
1. Characters that are mid-walk when a snapshot re-renders must keep their state classes and facing. Expected: no snapping back to seated mid-walk.
2. A crowded room with 8+ agents. Expected: chairs and desks don't overlap neighbouring seats or name tags.
3. The window is hidden or throttled during a walk. Expected: when the stalled-timeline commit fires, the state classes reach their final values too, so nobody is left walking in place forever.
4. A status change while the agent is walking, e.g. working→quiet during spawn. Expected: the pose applies once the walk ends, not halfway through it.
5. Reduced motion. Expected: no CSS animation runs on any limb.

---

### Task 1: Human rig, poses, chairs

**Files:**
- Modify: `src/scene/characters.ts`: `renderCharacter`, `updateCharacter`, `renderDesk`, plus a new chair renderer.
- Modify: `src/scene/looks.ts`: add `humanLook`, and map StatusLook to a pose class.
- Modify: `src/scene/styles.css`: rig keyframes and state/pose classes, ported from mockup A.
- Modify: `src/scene/rooms.ts`: place a chair at each seat, bigger for the boss.
- Test: `tests/looks.test.ts`, `tests/characters.test.ts` (new; pure helpers only).

**Interfaces:**
- Consumes: `looksFor(type)`, `agentLook(status)`, `bossLook(status)` (looks.ts), `CharacterOpts` (characters.ts), and seats from `roomLayout`.
- Produces:
  - `humanLook(id: string, type: string | 'boss'): { skin: string; hair: string; hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'curly'; shirt: string; pants: string; tie?: string }`. It is stable for an id. The boss gets suit `#3d3a5c` and tie `#d9455f`.
  - `poseClass(look: StatusLook, isBoss: boolean): 'pose-type' | 'pose-slump' | 'pose-wave' | 'pose-lean' | 'pose-idle'`. Mapping: working or delegating → type; quiet/stuck → slump (keeps the `zzz`/stuck fx); boss needs_you → wave; boss waiting_on_team → lean; idle → idle.
  - The DOM contract the Task 2 animator relies on:
    - `g.char > g.anim > g.dir > g.body` with limb groups `.leg.front/.back` (each holding `.shin`) and `.arm.front/.back`, plus a `.paper` in the front hand.
    - The `--L` custom property (half leg length) is set on `g.char`.
    - State classes on `g.char`: `walking`, `sitting`, `carrying`, `giving`, `cheer`.
    - Seated characters carry `sitting`.

- [ ] **Step 1: Write the failing tests**
  - `humanLook is stable per id and varies across ids`: same id gives deep-equal results; across 20 ids, at least 3 distinct skin tones and 3 distinct hairStyles.
  - `humanLook uses the agent-type colour for the shirt`: `humanLook('a1','Explore').shirt === looksFor('Explore').color`.
  - `boss wears a suit and tie`: `humanLook('boss','boss')` returns `shirt '#3d3a5c'` and `tie '#d9455f'`.
  - `poseClass maps statuses`: `poseClass(agentLook('working'),false)` → `'pose-type'`; `agentLook('quiet')` → `'pose-slump'`; `poseClass(bossLook('needs_you'),true)` → `'pose-wave'`; `bossLook('waiting_on_team')` → `'pose-lean'`; `bossLook('idle')` → `'pose-idle'`.
- [ ] **Step 2: Run `npx vitest run tests/looks.test.ts tests/characters.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `humanLook` and `poseClass` (looks.ts).** Port the rig from mockup A into `renderCharacter`/`updateCharacter`, port the furniture into `renderDesk` plus a new `renderChair(boss: boolean)` placed by rooms.ts at each seat, and port the CSS keyframes. Seated is the default for present agents. Remove the blob-only drawing code and its now-unused accessories, and update or remove looks tests that pinned blob-only fields. The compact strip boss becomes a head-and-shoulders bust: render the rig and clip it to above the hips. Keep name tags, timers and fx bubbles positioned above the new head height.
- [ ] **Step 4: Run the full suite, then `npm run build:scene`.** Visual check: `npm run serve` on a non-default port plus `npm run demo -- --sessions 2`. People sit on chairs at desks and the poses read clearly. Expected: tests PASS.
- [ ] **Step 5: Commit** `feat: human office characters with chairs and poses`.

### Task 2: Walk cycle and choreography in the animator

**Files:**
- Modify: `src/scene/animator.ts`
- Test: `tests/animator.test.ts`

**Interfaces:**
- Consumes: the Task 1 DOM contract and state classes. Existing `planAnimations`, `runAnimations`, `tween`, `DURATIONS`.
- Produces:
  - `stepClasses(kind: AnimKind): { add: string[]; remove: string[] }`. The mapping:

    | kind | add | remove |
    |---|---|---|
    | enter_door | `walking` | `sitting` |
    | walk_to_desk | `walking` | `sitting` |
    | walk_to | `walking`, `carrying` | `sitting` |
    | give | `giving` | `walking`, `carrying` |
    | exit_door | `walking` | `giving`, `carrying`, `sitting` |
    | celebrate | nothing on the walker (the receiver gets `cheer` for the step's duration) | |

    When walk_to_desk finishes, the character gets `sitting` and loses `walking`.
  - `facing(fromX: number, toX: number, current: 1 | -1): 1 | -1`. Returns 1 when moving right, -1 when moving left, and `current` when |dx| < 1. The animator sets `g.dir` to `scale(${f},1)` before each walk.

- [ ] **Step 1: Write the failing tests**
  - `stepClasses maps each walk kind` asserts the table above exactly.
  - `facing turns toward travel`: `facing(10,50,-1)===1`; `facing(50,10,1)===-1`; `facing(10,10.5,-1)===-1`.
  - `final classes are committed on a stalled timeline`: reuse the stubbed never-finishing Animation from the Task 10 tests. After the safety timeout, a walk_to_desk step leaves the character with `sitting` and without `walking`.
- [ ] **Step 2: Run `npx vitest run tests/animator.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Apply `stepClasses` when each step starts. Set facing before every move.
  - On finish, or on the stalled-timeline commit, apply the end classes (walk_to_desk → sitting). A cancelled queue restores the seated state.
  - Snapshot re-renders must not strip state classes from a character that has a running step. `updateCharacter` preserves them.
  - Pose classes from Task 1 are suppressed while `walking` is present (CSS selector order). Under reduced motion, add no animation, and moves keep the 300 ms fades.
  - The receiver's `cheer` is removed when celebrate ends.
- [ ] **Step 4: Run the full suite and `npm run build`.** Visual check with serve + demo: helpers walk in with swinging legs, sit, stand, carry the paper to the boss, the boss waves, and they turn and walk out the door facing the right way. Expected: PASS.
- [ ] **Step 5: Commit** `feat: walk cycle and seated choreography`.
