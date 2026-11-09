# Report

Measured on 9 November 2026 with protocol 3 ([bench/PROTOCOL.md](../bench/PROTOCOL.md)), at
commit `6c63e99`, on one Apple M5 Pro laptop on AC power. Chromium 158, headless, Node 22.16.
Raw data is in [runs/2026-11-09-redesign](../runs/2026-11-09-redesign).

This is the second run of protocol 3. The first, on 6 November at commit `91696b9`, is in
[runs/2026-11-06-final](../runs/2026-11-06-final). Between them the viewer and the receipt
scene were redrawn, so the numbers were measured again on the new build. The reducers, the
commands and the recorded project did not change, and every final state hash is the same in
both runs. [What moved between the runs](#what-moved-between-the-two-runs) compares them.

## Result

The target was p95 seek to coherent state below 100 ms on a 20,000 command log.

**It passed.** The p95 of each of 5 independent runs was between 19.7 and 35.2 ms, with a
median of 22.1 ms. Replaying from the start through the same viewer took 1,074 ms (1,048 to
1,659). That is about 49 times slower.

| Workload | Commands | State size | Checkpointed p95 | Replay from start p95 |
|---|---:|---:|---:|---:|
| Short, recorded through the editor | 10 | 1.2 KB | 3.2 ms (2.5 to 5.7) | 3.2 ms (2.6 to 5.1) |
| Long, generated | 2,000 | 28 KB | 3.3 ms (3.0 to 5.0) | 9.2 ms (8.3 to 15.2) |
| Stress, generated | 20,000 | 452 KB | 22.1 ms (19.7 to 35.2) | 1,074 ms (1,048 to 1,659) |

Values are the median of the run level p95 across 5 runs, with the range across runs.
Warm seeks only, after a 41 seek warmup. Checkpointed runs have 300 seeks each, except short,
which has all 10 of its distinct times. Replay runs have 60, since each can take a second.

**Checkpoints do not help a real demo.** On the short recording both variants take 3.2 ms. On
the 2,000 command log either would feel instant. The gain only matters for very long
recordings, and nobody has made one that long in a real authoring session.

## What the headline leaves out

- **The first seek is not warm.** On the stress log the slowest of four first seeks in a
  fresh page took 1,191 ms at the median of runs (1,149 to 1,826), against 1,300 ms for the
  baseline. Checkpoints are built by a background walk after the page paints, so they cannot
  help until it has run. The page itself appears in 137 ms. The walk runs in slices of about
  10 ms, which leaves gaps for input, but input latency during the walk was not measured. On
  the short and long logs the slowest first seek took 3.4 and 6.0 ms.
- **The baseline is the worst case for no checkpoints.** Every seek replays from zero. A
  player that keeps its position does better on forward seeks. In a separate single Node
  run on 6 November, over the same 100 positions, its p95 was 763 ms, against 1,287 ms
  replaying from zero. Checkpoints in that run took 24 ms over 2,000 positions. The engine
  has not changed since, so that run was not repeated. Half of random seeks go backward,
  so resuming helps less than it sounds.
- **Stress is a synthetic extreme.** It holds 2,000 receipts and each draft edit recomputes
  balances over the ledger. A different scene has a different cost per command.
- **Lab timings.** One laptop, headless, with other work running, and more of it than in
  the first run. The load average was 7 to 49 across the runs, on 18 logical cores. Run 4
  met the heaviest load and gave the slowest p95 of every workload. This is not field INP. The next frame metric does
  not prove a frame reached the display.
- **Sample spread.** One of 30 warm samples had a median position outside 0.4 to 0.6: long
  baseline run 4, at 0.635. With 60 samples that is expected by chance. Short has only 10
  times, so its median position is 0.4 by construction.

## Other measurements

| Metric | Short | Long | Stress |
|---|---:|---:|---:|
| Time until the viewer appears | 59 ms | 82 ms | 137 ms |
| Slowest of four first seeks | 3.4 ms | 6.0 ms | 1,191 ms |
| Median of four first seeks | 3.1 ms | 5.3 ms | 615 ms |
| Warm seek to next frame, p95 | 17.3 ms | 16.8 ms | 22.3 ms |
| Export time, median of 5 | 223 ms | 296 ms | 5,001 ms |
| Bundle size | 514 KB | 1.1 MB | 6.4 MB |

Viewer JavaScript and CSS total 341 KB, or 105 KB with gzip, on every workload. The rest is
three font files and the project data. A viewer loads only the scene its project needs.

**Rapid scrubbing on stress**, with 120 requests at least 16 ms apart and no wait for each
seek: with checkpoints all 120 reached a committed state, in 3,086 ms. Without them only 13
to 23 did, in 5,530 ms. Every run ended on the last request.

**Checkpoint memory could not be measured.** Heap after a forced collection was 10.0 MB with
checkpoints and 10.1 to 10.5 MB without, so any cost sits below run to run variation. States
share unchanged data, which is why. This log stores 79 checkpoints, and no file can store
more than 1,024. As separate JSON, 79 copies of the final state would take at most 36 MB.

## Correctness

| Check | Scope | Result |
|---|---|---|
| Seek against replay, by state hash | 5,332 declared positions on 4 logs, both scenes | 0 mismatches |
| Independent oracles, one per scene | Every command of every log. On stress it steps every command and compares every 25th. | 0 problems |
| Rendered scene against a server render of a replay | 340 checks in real Chromium, across 5 runs and both variants. Positions repeat between variants. | 340 of 340 matched |
| Negative controls | 14 seeded failures | 14 detected |
| Mutants, from the first run | 38 seeded source changes | 36 killed, 2 equivalent |

The seek check covers positions just before and after commands, equal timestamps and
checkpoint boundaries. A fuzz test also drives the real `Playback` and `SeekController` with
random operations and forced interleaving.

In 330 of the 340 rendered checks, a state one command old would have looked different, so
that check has real power. In the other 10 it could not tell.

The oracles share no code with the scenes and use exact BigInt arithmetic. Six controls are
money bugs in the reducer. All six showed 0 seek mismatches, because replay and seek share
the bug. Only the oracle found them.

The two equivalent mutants are listed in `mutants.json` of the first run with the reason
neither can change behaviour. Each kill records which test caught it, and the unmodified
suite passed first. The mutants change reducers and engine code, which the redesign did not
touch, so they were not run again.

Browser suite: 135 test runs. Chromium runs all 97 distinct tests. WebKit and Firefox each
repeat the 9 exported viewer tests and the 10 project page tests. The editor was only tested
in Chromium. Axe finds no violations on the story, branch, return panel, embed, transcript,
start page or editor. Automated checks do not establish full accessibility.

## What moved between the two runs

| Stress log, median of 5 runs | 6 November, `91696b9` | 9 November, `6c63e99` |
|---|---:|---:|
| Warm seek p95, checkpointed | 17.4 ms (16.7 to 17.6) | 22.1 ms (19.7 to 35.2) |
| Warm seek p95, replay from start | 973 ms (889 to 1,046) | 1,074 ms (1,048 to 1,659) |
| Warm seek p95, short recording | 1.1 ms | 3.2 ms |
| Time until the viewer appears | 119 ms | 137 ms |
| Viewer JavaScript and CSS, gzip | 91 KB | 105 KB |
| Load average during the runs | 5 to 11 | 7 to 49 |

Two things changed at once, and this run cannot separate them. The new viewer does more on
every seek: the scene has more elements, and the stage places a pointer and a callout. The
machine was also busier. The short recording shows the first cost most clearly, because
almost nothing else happens there: about 2 ms more per seek. The replay from the start is
dominated by the reducer, which did not change, and it got about 10 percent slower, so that
much is most likely load.

One regression was found by this measurement and fixed before the run above. The first
build of the new timeline drew one element per command and restyled the ones the playhead
had passed. On the stress log that put the warm p95 at 41.8 ms in a single trial run and
about doubled the heap. The dots are now one path, drawn once, and the passed ones are the same
path cut off at the playhead.

## What changed because of measurement

1. **Share cache.** The first engine run missed the target before rendering: warm p95 of
   133 ms, under load. The profile showed largest remainder allocation taking most of the
   time, because each draft edit reran it for every receipt. Caching shares per immutable
   expense cut full replay from 12.7 s to 3.4 s under similar load, with identical state
   hashes at that commit.
2. **One load pass.** The viewer replayed the whole log to validate, again for the
   transcript, and again on the first seek. The page took 2.8 s to appear on stress. It now
   paints first and one background walk does the validating and the checkpoints.
3. **The walk gives way.** That first fix raised the first seek to 2.8 s, because the seek
   and the walk shared the thread. The walk now waits.

## What failed

- **Protocol 1 was invalid.** Its seek positions were skewed toward early, cheap states by a
  weak generator, so it reported 17.5 ms and 948 ms. The browser baseline p50 of 98 ms did not
  match 672 ms in Node, and that is how it was caught. The run was discarded, and the
  sampler now has a uniformity test.
- **Protocol 2 was superseded.** Its numbers held under audit, but the audit found defects in
  the code it measured, so the run was repeated on fixed code. Warm p95 moved from 19.4 to
  17.4 ms and the baseline from 1,077 to 973 ms. That difference is load on the machine, not
  an improvement. Treat either as the same result.
- **Two automated code reviews found defects the tests had missed**, 8 of them high severity,
  and corrected 10 of my claims. Each fix has a regression test in `tests/`. The reviews
  changed three design decisions, listed in [DESIGN.md](DESIGN.md).

## Limits

- Reel records scenes that implement `SceneAdapter`. It cannot record an arbitrary site.
- A file's worst case is bounded, not fast. A 100,000 command log of expensive commands is
  validated synchronously in the editor, and the page will stall. The viewer does this in
  slices. Limits are in [FORMAT.md](FORMAT.md).
- WebKit tests need the display awake on macOS. With it asleep, rendering updates stop and
  clicks on framed scenes fail. This hit old and new builds equally, and passes once awake.
- Commands before a trim start ship in the export, because they build the first state.
- Two tabs on one draft: the last save wins.
- Replacing a folder export takes two renames. A crash in that gap leaves the old export in a
  `.previous` folder rather than in place.
- Video export was stretch scope and is not built.
- No person has used this in a study.

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

A fresh `git clone` of commit `b84472a`, on the same machine, with a frozen lockfile. Source
files match the measured commit. Only the text of the project page, a benchmark script, the
media and documents changed after it.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm check` | Passed |
| `pnpm test` | 247 of 247 passed |
| `pnpm build` | Passed |
| `pnpm exec playwright test` | 135 of 135 passed on Chromium, WebKit and Firefox |
| `pnpm export` and `scripts/verify-bundle.ts` | 14 files matched, and the replay reproduced the final state |
| `pnpm build:site` | Built the project page with the exported viewer under it |

This shows a clean checkout works here. It was not repeated on a second machine.
