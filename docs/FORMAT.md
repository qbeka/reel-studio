# Adapter and project format

Version 1. This is the contract between a scene, the recorder and the viewer.

## What Reel records

Reel records semantic commands that a scene declares, such as `setSplit`. It does not
record pixels, DOM mutations or mouse coordinates. It can only record scenes that
implement a `SceneAdapter` and are registered at build time. It cannot record arbitrary
websites.

## SceneAdapter

Defined in [`src/core/adapter.ts`](../src/core/adapter.ts).

| Member | Purpose |
|---|---|
| `id`, `version` | Identity. A project names both. `version` is a positive integer. |
| `title`, `summary` | Shown in the editor and in error messages. |
| `commandTypes` | The only command types the scene accepts. |
| `targets` | Stable named targets for framing. Renderers mark them with `data-reel-target`. |
| `layouts` | The logical size of the `wide` and `narrow` coordinate systems. |
| `init(seed)` | Initial state from an integer seed. All randomness flows from here. |
| `parse(type, payload)` | Payload validation, independent of state. Returns an error or null. |
| `precondition(state, command)` | Why this command is impossible now, or null. |
| `apply(state, command, clock)` | Pure transition. Returns a new state and never mutates the old one. |
| `effects(state, command)` | Optional. Outcomes a local fake service will report later. Runs only live. |
| `pendingEffects(state, t)` | Required with `effects`. Outcomes a state is still owed, so a fork during a save can finish. |
| `serialize(state)` | State as canonical JSON. Excludes transient presentation fields. |
| `restore(json, fromVersion)` | Rebuilds state from `serialize` output, migrating older versions. |
| `migrateCommand(command, fromVersion)` | Optional. Rewrites an older recorded command. |
| `describe(before, command, after)` | A plain transcript line, or null for an unimportant step. |
| `targetOf(command)` | The target a command acts on, or null. |
| `Render` | A React component. It receives `state`, `send`, `interactive` and `layout`. |

## Logical time and rendering time

`t` is logical time: whole milliseconds since the start of the recording. It decides what
state exists. Nothing in a scene may read `Date.now`, `performance.now` or `Math.random`.
`apply` receives `{ t }` and any randomness comes from a seeded generator held in state.

The rendering clock is `requestAnimationFrame`. It only decides how fast logical time
moves during playback. Dropping frames changes when a state appears, never which state.

## Event order

Every recorded command has an integer `t` and a unique integer `seq`.

Order is `t` ascending, then `seq` ascending. Equal timestamps are legal and stable.

The state at logical time `T` is the initial state plus every command with `t <= T`, in
order. A command at exactly `T` has already happened.

## Asynchronous outcomes

An outcome is an ordinary log entry with `source: "outcome"`. During live recording, or in
a viewer's branch, `effects` returns outcomes for a local fixture service to deliver after
a delay. The recorder logs what arrived. Playback reads the log and never runs `effects`,
so it cannot repeat a payment or call a service.

The default fixtures have no external effects at all.

## Project file

A `.reel.json` file holds data and nothing that can execute.

```json
{
  "format": "reel-project",
  "formatVersion": 1,
  "id": "receipt-split-demo",
  "title": "Fix a receipt split",
  "disclosure": "Synthetic data. No real people, receipts or balances.",
  "scene": { "id": "receipt-split", "version": 1 },
  "seed": 7,
  "checkpointEvery": 256,
  "trim": { "start": 0, "end": 24000 },
  "posterT": 9000,
  "commands": [
    { "seq": 1, "t": 900, "type": "selectExpense", "payload": { "id": "e2" }, "source": "user" }
  ],
  "chapters": [{ "id": "open", "t": 0, "title": "Open the receipt" }],
  "captions": [{ "id": "c1", "start": 0, "end": 3000, "text": "Pick a receipt.", "target": "expense-list" }],
  "camera": [{ "id": "s1", "t": 0, "target": null }]
}
```

The four tracks stay separate. `commands` decide scene state. `chapters`, `captions` and
`camera` only decide presentation, so editing them can never change a state hash.

`trim` is not destructive in the project file. Commands before `trim.start` still run, as a
silent prologue, and they ship in the export because they build the state at the start.
Commands, chapters and captions after `trim.end` are removed from the export. If a prologue
must not ship, record it again without that part.

Limits on a file: 100,000 commands, 64 chapters, 512 captions, 512 camera shots, 400
characters of text, and a `seq` up to 2^40. A timeline stores at most 1,024 states, widening
the interval if a file asks for more. The receipt scene holds at most 5,000 receipts and the
retry queue at most 2,000 jobs, which keeps the cost of every command bounded.

## Scene resolution

A project names an adapter by id and version. Nothing in a project file can add code.

| Project asks for | Result |
|---|---|
| An installed id and the same version | Loads. |
| An installed id and an older version, with a migration | Loads after migration. |
| An installed id and an older version, with no migration | Refused with a message. |
| An installed id and a newer version | Refused with a message. |
| An unknown id | Refused. The message lists what is installed. |

## Hashing

`canonicalize` sorts object keys, turns `-0` into `0`, and rejects `undefined`, `NaN`,
infinities and non-plain objects. A state hash is the SHA-256 of the canonical JSON of
`serialize(state)`.

Excluded from hashing, because they only drive presentation:

| Scene | Excluded field | Reason |
|---|---|---|
| `receipt-split` | `presentation.flash` | Which row to highlight after an edit. |
| `retry-queue` | `presentation.pulse` | Which job to highlight after a change. |
