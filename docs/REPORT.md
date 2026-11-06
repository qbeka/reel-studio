# Report

Measured on 6 November 2026 with protocol 2 ([bench/PROTOCOL.md](../bench/PROTOCOL.md)), at
commit `4556b12`, on one Apple M5 Pro laptop on AC power. Chromium 158, headless, Node 22.16.
Raw data is in [runs/2026-11-06-final](../runs/2026-11-06-final).

## Result

The target was p95 seek to coherent state below 100 ms on a 20,000 command log.

**It passed.** The p95 of each of 5 independent runs was between 17.4 and 22.0 ms, with a
median of 19.4 ms. Replaying from the start through the same viewer took 1,077 ms (1,034 to
1,156). That is about 55 times slower.

| Workload | Commands | State size | Checkpointed p95 | Replay from start p95 |
|---|---|---:|---:|---:|
| Short, recorded through the editor | 10 | 1.2 KB | 1.2 ms (1.0 to 1.4) | 1.2 ms (1.1 to 1.3) |
| Long, generated | 2,000 | 28 KB | 2.2 ms (2.2 to 2.3) | 8.2 ms (7.8 to 10.5) |
| Stress, generated | 20,000 | 452 KB | 19.4 ms (17.4 to 22.0) | 1,077 ms (1,034 to 1,156) |

Values are the median of the run level p95 across 5 runs, with the range across runs.
Warm seeks only, after a 41 seek warmup. Checkpointed runs have 300 seeks each, except short,
which has 9 distinct times. Replay runs have 60, since each takes about a second.

**Checkpoints do not help a real demo.** On a short recording both variants take 1.2 ms. On
the 2,000 command log either would feel instant. The gain only matters for very long
recordings, and nobody has made one that long in a real authoring session.

## What the headline leaves out

- **The first seek is not warm.** On the stress log the slowest first seek in a fresh page
  took 1,135 ms (1,098 to 1,280), against 1,272 ms for the baseline. Checkpoints are built
  by a background walk after the page paints, so they cannot help until it has run. The
  page itself appears in 122 ms, and that walk does not block input. On the short and long
  logs the slowest first seek took 3.0 and 4.7 ms.
- **The baseline is the worst case for no checkpoints.** Every seek replays from zero. A
  player that keeps its position does better on forward seeks. In a separate single Node
  run on the same positions its p95 was 801 ms against 1,257 ms for the Node baseline and
  20 ms with checkpoints. Half of random seeks go backward, so resuming helps less than it
  sounds.
- **Stress is a synthetic extreme.** It holds 2,000 receipts and each draft edit recomputes
  balances over the ledger. A different scene has a different cost per command.
- **Lab timings.** One laptop, headless, with other work running. The load average was 6 to
  14 across the runs, on 18 logical cores. This is not field INP. The next frame metric
  does not prove a frame reached the display.

## Other measurements

| Metric | Short | Long | Stress |
|---|---:|---:|---:|
| Time until the viewer appears | 43 ms | 54 ms | 122 ms |
| Slowest first seek | 3.0 ms | 4.7 ms | 1,135 ms |
| Median first seek | 2.7 ms | 4.0 ms | 433 ms |
| Warm seek to next frame, p95 | 17.6 ms | 17.0 ms | 20.5 ms |
| Export time, median of 5 | 175 ms | 245 ms | 4,438 ms |
| Bundle size | 431 KB | 1.0 MB | 6.3 MB |

Viewer JavaScript and CSS total 291 KB, or 91 KB with gzip, on every workload. The rest is
two font files and the project data. A viewer loads only the scene its project needs.

**Rapid scrubbing on stress**, with a request every 16 ms for 120 positions: with checkpoints
all 120 positions reached a committed state, in 2,977 ms. Without them only 18 to 23 of 120
did, in 5,415 ms. Every run ended on the last request.

**Checkpoint memory could not be measured.** Heap after a forced collection was 8.6 MB with
checkpoints and 8.7 to 9.7 MB without, so any cost sits below run to run variation. States
share unchanged data, which is why. The hard limit is 79 stored states here, and 1,024 for
any file. Stored as separate JSON, 79 copies of the final state would take at most 36 MB.

## Correctness

| Check | Scope | Result |
|---|---|---|
| Seek against replay, by state hash | 5,332 declared positions on 4 logs, both scenes | 0 mismatches |
| Independent oracle | Every command of every log. On stress it steps every command and compares every 25th. | 0 problems |
| Rendered scene against a server render of a replay | 340 positions in real Chromium | 340 of 340 matched |
| Negative controls | 14 seeded failures | 14 detected |
| Mutants | 38 seeded source changes | 36 killed, 2 equivalent |

The seek check covers positions just before and after commands, equal timestamps and
checkpoint boundaries. A fuzz test also drives the real `Playback` and `SeekController` with
random operations and forced interleaving.

At 330 of the 340 rendered positions, a state one command old would have looked different,
so that check has real power. At the other 10 it could not tell.

The oracle shares no code with the scene and uses exact BigInt arithmetic. Six controls are
money bugs in the reducer. All six showed 0 seek mismatches, because replay and seek share
the bug. Only the oracle found them.

The two equivalent mutants are listed in `mutants.json` with the reason neither can change
behaviour. Each kill records which test caught it, and the unmodified suite passed first.

Browser suite: 95 tests. Chromium runs all of them. WebKit and Firefox run the exported
viewer spec. The editor was only tested in Chromium. Axe finds no violations on the story,
branch, return panel, embed, transcript, start page or editor. Automated checks do not
establish full accessibility.

## What changed because of measurement

1. **Share cache.** The first engine run missed the target before rendering: warm p95 of
   133 ms, under load. The profile showed the largest remainder allocation taking most of
   the time, because each draft edit reran it for every receipt. Caching shares per
   immutable expense cut full replay from 12.7 s to 3.4 s under similar load, with identical
   state hashes. See `runs/2026-11-06-engine-before-share-cache`.
2. **One load pass.** The viewer replayed the whole log to validate, again for the
   transcript, and again on the first seek. The page took 2.8 s to appear on stress. It now
   paints first and one background walk does the validating and the checkpoints. See
   `runs/2026-11-06-viewer-before-load-fix`.
3. **The walk gives way.** That first fix doubled the first seek to 2.8 s, because the seek
   and the walk shared the thread. The walk now waits. See
   `runs/2026-11-06-viewer-seek-and-walk-compete`.

## What failed

- **Protocol 1 was invalid.** Its seek positions were skewed toward early, cheap states by a
  weak generator, so it reported 17.5 ms and 948 ms. The browser baseline p50 of 98 ms
  did not match 672 ms in Node, and that is how it was caught. The run is kept in
  `runs/2026-11-06-protocol-1-skewed-positions`. Do not quote it. Version 2 tests its sampler.
- **An independent review found 17 defects the tests had missed**, 6 of them high severity.
  It also showed the first coherence check accepted most states one command stale, the scrub
  count measured requests rather than commits, and 10 of 29 mutants survived. All were
  fixed, and each defect now has a regression test. The review ran on a clean clone and
  changed three design decisions, listed in [DESIGN.md](DESIGN.md).

## Limits

- Reel records scenes that implement `SceneAdapter`. It cannot record an arbitrary site.
- A file's worst case is bounded, not fast. A 100,000 command log of expensive commands is
  validated synchronously in the editor, and the page will stall. The viewer does this in
  slices. Limits are in [FORMAT.md](FORMAT.md).
- Commands before a trim start ship in the export, because they build the first state.
- Two tabs on one draft: the last save wins.
- Replacing a folder export takes two renames. A crash in that gap leaves the old export in a
  `.previous` folder rather than in place.
- Video export was stretch scope and is not built.
- No person has used this in a study. [USABILITY.md](USABILITY.md) has a task script and a
  heuristic review, which is the author's review and not user research.

## Reproduce

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm exec playwright install chromium webkit firefox
```

```bash
pnpm bench
```

This takes about 15 minutes and writes to `runs/<date>-local`. Numbers will differ on other
machines. The state hashes in `manifest.json` should not.

## Clean checkout

A fresh `git clone` of commit `2fc2deb`, on the same machine, with a frozen lockfile.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm check` | Passed |
| `pnpm test` | 232 of 232 passed |
| `pnpm build` | Passed |
| `pnpm exec playwright test` | 95 of 95 passed on Chromium, WebKit and Firefox |
| `pnpm export` and `scripts/verify-bundle.ts` | 13 files matched, and the replay reproduced the final state |
| `pnpm demo` | Served the viewer and the embed at `/projects/reel/` |

This shows a clean checkout works here. It was not repeated on a second machine.
