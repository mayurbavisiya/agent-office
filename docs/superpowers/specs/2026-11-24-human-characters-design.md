# Human office characters: short design

**Status:** approved by the person on 2026-11-24 ("office people looks ok", then "implement new change").
**Builds on:** `2026-11-23-agent-office-design.md`. Everything not mentioned here is unchanged.
**Reference mockup:** `.superpowers/brainstorm/25958-1795507439/content/humans.html`, option A "Office people". It has the working rig, keyframes and furniture geometry.

## Intent
The person wants the cartoon blobs replaced by human avatars that walk properly and sit on chairs. The reason is the original goal: Agent Office should be as fun to watch as it is useful for monitoring.

## Goals
- Every character (boss and agents) is a flat-vector office person drawn as an SVG rig: head, hair, eye, torso/shirt, two arms (with hands), and two legs. Each leg is a thigh plus a shin with a knee pivot, and ends in a shoe.
- A proper walk cycle while moving: legs and knees swing, arms swing opposite, the body bobs. Characters always face the way they walk.
- Every desk has a chair, and the boss's chair is bigger. Seated characters sit on the chair: thighs horizontal, shins down, hands on the desk.
- Choreography:
  - spawn: walk from the door to the chair, then sit.
  - handoff: stand up, walk to the receiver carrying a paper, raise it to them. The receiver (boss, or the parent agent) waves.
  - left: turn and walk out the door.
- Status poses replace the blob expressions:
  - working: seated, typing.
  - quiet / maybe stuck: seated and slumped, head on hand, a small "z".
  - needs you (boss): standing beside the chair, waving.
  - waiting on team (boss): seated, leaning back, arms crossed.
  - idle: seated and still, gently breathing.
  - delegating (boss): seated, typing.
- Look:
  - Shirt colour is the agent-type colour that already exists in `looks.ts` (`looksFor(type).color`).
  - Skin tone and hairstyle come from a stable hash of the agent id, picked from a small, diverse palette.
  - The boss wears a dark suit and a tie, and keeps the "Main agent" tag. No crown.
- Compact strip: a head-and-shoulders bust of the boss.
- `prefers-reduced-motion`: no walk cycle and no limb animation. Moves become the existing 300 ms fades, and poses are static.

## Non-goals
- No new libraries, sprite sheets or image assets. Pure SVG + CSS, like the rest of the scene.
- No change to the store, server, panel, zoom, counters or Electron shell.

## Anti-goals
- Characters must still read clearly in a small floating window. Name tags and status must not become harder to see than they are today.
- No regressions in the animator's guarantees from Task 10:
  - end state is committed on stalled timelines
  - sticky seats
  - helpers sit near their parent
  - departing agents are kept until their exit finishes
  - ended rooms leave the floor

## Approaches considered
1. **SVG rig + CSS keyframes (chosen).** It matches the existing SVG scene and animator, and the mockup proved it.
2. Sprite sheets or Lottie: needs drawn art assets and a player, and the art is harder to vary per agent.
3. A skeletal-animation or game engine (e.g. Spine, PixiJS): a heavy dependency, and a rewrite of the scene for the same result.

## Left to the builder
- Exact proportions, palettes and keyframe timings. Start from mockup option A.
- How walk-cycle classes are toggled from the animator. The animator already owns position. Limb animation should be driven by state classes on the character: `walking`, `sitting`, `carrying`, `giving`, `cheer`, plus the pose classes.
- Fitting the chair and desk geometry to the existing room layout and seat grid.
