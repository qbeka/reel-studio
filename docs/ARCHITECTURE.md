# Architecture

Four kinds of data stay apart, and the code follows that split.

| Data | Lives in | Changed by | Affects |
|---|---|---|---|
| Authored commands | `project.commands` | Recording, repair-checked edits | Scene state |
| Tracks | `project.chapters`, `captions`, `camera` | Editor | Presentation only |
| Scene state | `Timeline` | Replaying commands | What the stage shows |
| Branch state | `LiveSession` in the viewer | The viewer's edits | One page view, then gone |

## Modules

```
src/core        No React and no DOM. Everything here runs in Node tests.
  adapter.ts      The SceneAdapter contract.
  timeline.ts     Order, checkpoints and replay.
  seek.ts         Latest-wins seeks and the background walk.
  playback.ts     Moves logical time with the rendering clock.
  session.ts      A scene running live: recording and viewer branches.
  branch.ts       Fork, reset and the rules for returning.
  edit.ts         Edit proposals, repair and undo history.
  project.ts      The file format, its limits and its validation.
  registry.ts     Resolves a project to installed scene code.
  camera.ts       Framing math, the mix between two shots and the pace of a move.
  pointer.ts      Where the drawn pointer is at a time, and which keys are down, from the command log.
  diff.ts         What differs between two states, by named field or by path.
  transcript.ts   The plain story, from a replay.
src/scenes      One folder per scene, plus the registry.
src/player      Stage, the chaptered timeline, the look ahead, the pointer handoff and the viewer.
src/editor      Start page, workspace, timeline and inspector.
src/export      Bundle assembly, shared by the browser and the command line.
src/storage     Drafts in IndexedDB.
bench           Fixtures, the seek harness, negative controls, measurement.
tests/oracle    Independent models. They import nothing from src.
```

## Seeking

A seek turns a time into a command count with a binary search, restores the nearest stored
state, and applies the commands in between.

`Timeline` stores the state after every Nth command, by reference. This is safe because
`apply` must return new objects, and the tests deep-freeze every state to enforce it.
Unchanged parts of a state are shared, so a checkpoint costs about what changed since the
last one. A warm seek applies at most N - 1 commands, and at most 1,024 checkpoints exist. If a
log would need more, the interval widens to fit. `parseProject` caps the log length.

`SeekController` runs work in slices limited by time. A newer request abandons an older
one at its next slice boundary, and only the newest complete state reaches `onCommit`.

## Loading

The viewer checks command shapes and tracks at load, which needs no replay, and paints.
`SeekController.prepare` then walks the log in slices. That one pass fills the checkpoints
and checks each command against its state, so validation and preparation are not separate
replays. The walk stands aside while a seek runs and resumes past whatever the seek covered.
The transcript is computed at export, so viewers do not replay to build it.

## Why playback cannot repeat an effect

`effects` is only called by `LiveSession`. Playback uses `Timeline`, which has no path to
it. Outcomes reached the log during recording as ordinary entries with `source: "outcome"`.

## Returning from a branch

A branch never merges. Returning always restores a recorded state. Choose a moment compares the
canonical hash of the viewer's state with the authored state at each chapter. An exact
match means nothing is lost, and the list marks it. Anything else sets the branch aside. The
answer is computed from the live state, and pressing the app closes the list, so a late
outcome cannot leave a stale promise on screen.

A copy set aside stays in memory, with its original base, so the viewer can bring it back
until they next press Take over or leave the page. Nothing in a branch is written to storage,
the URL or the project.

A state can be waiting for an outcome when a branch starts, such as a fork during a save.
The timer that would have delivered it belonged to the recording, so `pendingEffects` re-arms
it for the new session.

## Export

`assembleBundle` is a pure function of the project, the adapter and the prebuilt viewer.
The command line writes the result to a temporary folder and renames it into place, so an
failure while writing leaves the previous one untouched. The editor builds the same files in
memory and offers a zip only when every file is ready. All URLs are relative, so a bundle
works under any path. `bundle-manifest.json` lists the hash of every file and the final state
hash, and `scripts/verify-bundle.ts` checks both, including a full replay.

## Adding a scene

1. Create `src/scenes/<name>/adapter.ts` with a `SceneAdapter`, and a `Render` component
   that marks its targets with `data-reel-target`.
2. Add one entry to `src/scenes/registry.ts`.
3. Add its stylesheet to `src/styles/scenes.css`, with every rule nested under one class.

The retry queue took exactly those three steps. Bundled scene code is trusted and compiled
at build time. A project file can only name a scene that is already installed.
