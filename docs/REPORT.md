# Report

Measured on 10 November 2026 (UTC) with protocol 3 ([bench/PROTOCOL.md](../bench/PROTOCOL.md)),
on one Apple M5 Pro laptop on AC power. Chromium 158, headless, Node 22.16. Raw data is in
[runs/2026-11-10-pass2](../runs/2026-11-10-pass2), with the commit in its manifest.

This is the third run of protocol 3. The first, on 6 November at commit `91696b9`, is in
[runs/2026-11-06-final](../runs/2026-11-06-final). The second, on 9 November at `6c63e99`, is
in [runs/2026-11-09-redesign](../runs/2026-11-09-redesign). The viewer and the scenes were
redrawn before each of the later two, so the numbers were measured again on each new build.
The reducers, the commands and the recorded project did not change, and every final state
hash is the same in all three runs. [What moved between the runs](#what-moved-between-the-runs)
compares them.

## Result

The target was p95 seek to coherent state below 100 ms on a 20,000 command log.

**It passed.** The p95 of each of 5 independent runs was between 21.2 and 25.5 ms, with a
median of 23.3 ms. Replaying from the start through the same viewer took 1,130 ms (984 to
1,290). That is about 48 times slower.

| Workload | Commands | State size | Checkpointed p95 | Replay from start p95 |
|---|---:|---:|---:|---:|
| Short, recorded through the editor | 10 | 1.2 KB | 3.5 ms (3.0 to 4.0) | 3.1 ms (2.7 to 4.1) |
| Long, generated | 2,000 | 28 KB | 3.5 ms (3.4 to 4.6) | 9.3 ms (8.9 to 11.3) |
| Stress, generated | 20,000 | 452 KB | 23.3 ms (21.2 to 25.5) | 1,130 ms (984 to 1,290) |

Values are the median of the run level p95 across 5 runs, with the range across runs.
Warm seeks only, after a 41 seek warmup. Checkpointed runs have 300 seeks each, except short,
which has all 10 of its distinct times. Replay runs have 60, since each can take a second.

**Checkpoints do not help a real demo.** On the short recording a seek takes 3.5 ms with
checkpoints and 3.1 ms without, and the two ranges overlap almost entirely. On the 2,000
command log either would feel instant. The gain only matters for very long recordings, and
nobody has made one that long in a real authoring session.

## What the headline leaves out

- **The first seek is not warm.** On the stress log the slowest of four first seeks in a
  fresh page took 1,253 ms at the median of runs (1,198 to 1,365), against 1,339 ms for the
  baseline. Checkpoints are built by a background walk after the page paints, so they cannot
  help until it has run. The page itself appears in 144 ms. The walk runs in slices of about
  10 ms, which leaves gaps for input, but input latency during the walk was not measured. On
  the short and long logs the slowest first seek took 4.0 and 6.1 ms.
- **The baseline is the worst case for no checkpoints.** Every seek replays from zero. A
  player that keeps its position does better on forward seeks. In a separate single Node
  run on 6 November, over the same 100 positions, its p95 was 763 ms, against 1,287 ms
  replaying from zero. Checkpoints in that run took 24 ms over 2,000 positions. The engine
  has not changed since, so that run was not repeated. Half of random seeks go backward,
  so resuming helps less than it sounds.
- **Stress is a synthetic extreme.** It holds 2,000 receipts and each draft edit recomputes
  balances over the ledger. A different scene has a different cost per command.
- **Lab timings.** One laptop, headless, with other work running. The load average was 7 to
  21 across the runs, on 18 logical cores, which is calmer than the second run and busier
  than the first. This is not field INP. The next frame metric does not prove a frame
  reached the display.
- **Sample spread.** One of 30 warm samples had a median position outside 0.4 to 0.6: long
  baseline run 4, at 0.635. With 60 samples that is expected by chance. Short has only 10
  times, so its median position is 0.4 by construction.

## Other measurements

| Metric | Short | Long | Stress |
|---|---:|---:|---:|
| Time until the viewer appears | 66 ms | 73 ms | 144 ms |
| Slowest of four first seeks | 4.0 ms | 6.1 ms | 1,253 ms |
| Median of four first seeks | 3.5 ms | 5.8 ms | 669 ms |
| Warm seek to next frame, p95 | 16.8 ms | 16.8 ms | 23.5 ms |
| Export time, median of 5 | 235 ms | 312 ms | 5,182 ms |
| Bundle size | 562 KB | 1.1 MB | 6.5 MB |

Viewer JavaScript and CSS total 389 KB, or 115 KB with gzip, on every workload. The rest is
three font files and the project data. A viewer loads only the scene its project needs.

**Rapid scrubbing on stress**, with 120 requests at least 16 ms apart and no wait for each
seek: with checkpoints all 120 reached a committed state, in 3,147 ms. Without them only 16
to 22 did, in 5,789 ms. Every run ended on the last request.

**Checkpoint memory could not be measured.** Heap after a forced collection was 10.1 to 10.2 MB with
checkpoints and 10.3 to 10.7 MB without, so any cost sits below run to run variation. States
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
suite passed first. The mutants change reducers and engine code, which neither redesign
touched, so they were not run again.

Browser suite: 227 test runs. Chromium runs all 133 distinct tests. WebKit and Firefox each
repeat the 9 exported viewer tests and the 38 project page tests, and skip the two of those
that need a mouse over the timeline, which Chromium covers. The editor was only tested in
Chromium. Axe finds no violations on the story, the comparison, the keys sheet, the end
card, the branch, the return panel, embed, transcript, start page or editor. Automated
checks do not establish full accessibility.

## What moved between the runs

| Stress log, median of 5 runs | 6 November, `91696b9` | 9 November, `6c63e99` | 10 November, third run |
|---|---:|---:|---:|
| Warm seek p95, checkpointed | 17.4 ms (16.7 to 17.6) | 22.1 ms (19.7 to 35.2) | 23.3 ms (21.2 to 25.5) |
| Warm seek p95, replay from start | 973 ms (889 to 1,046) | 1,074 ms (1,048 to 1,659) | 1,130 ms (984 to 1,290) |
| Warm seek p95, short recording | 1.1 ms | 3.2 ms | 3.5 ms |
| Time until the viewer appears | 119 ms | 137 ms | 144 ms |
| Viewer JavaScript and CSS, gzip | 91 KB | 105 KB | 115 KB |
| Load average during the runs | 5 to 11 | 7 to 49 | 7 to 21 |

From the first run to the second, two things changed at once, and that run cannot separate
them. The viewer did more on every seek: the scene had more elements, and the stage placed
a pointer and a caption. The machine was also busier. The short recording showed the first
cost most clearly, because almost nothing else happens there: about 2 ms more per seek.

From the second run to the third the viewer changed again. Each commit now also plans a
press and typed keys for the pointer, veils what is outside a close shot, and draws a
larger scene: a tile for each person under the receipt, and a ledger on the balances
screen. The look ahead and the comparison do no work unless someone is using them, and the
measurement uses neither. On the short recording the cost is 0.3 ms more per seek, 3.2 to
3.5 ms, with the ranges of the two runs overlapping (2.5 to 5.7, then 3.0 to 4.0). On the
stress log the median moved from 22.1 to 23.3 ms, inside the range of the earlier run. So
the third run shows a small cost at most, and it cannot be told apart from the difference
in load between the two days. The replay from the start is dominated by the reducer, which
has not changed in any of the three, and it read 973, 1,074 and 1,130 ms, which is the size
of the noise to hold the other rows against.

The viewer grew by 10 KB with gzip, to 115 KB. That is the look ahead, the comparison, the
drawn keys and the second scene's new face.

One regression was found by the second measurement and fixed before its run. The first
build of that timeline drew one element per command and restyled the ones the playhead
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

A fresh `git clone` of commit `4bee208`, on the same machine, with a frozen lockfile. The
viewer that was measured was built at `afbae05`. After it, three things under `src` changed:
the comparison no longer outlines a control that is hidden, its panel says nothing about
outlines when no value differs, and the handler behind Compare was tidied. None of them is on
the path a seek takes. Everything else after the measured build is the project page, the
tests, the media and documents.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm check` | Passed |
| `pnpm test` | 286 of 286 passed |
| `pnpm build` | Passed |
| `pnpm exec playwright test` | 223 passed and 4 skipped on Chromium, WebKit and Firefox |
| `pnpm export` and `scripts/verify-bundle.ts` | 14 files matched, and the replay reproduced the final state |
| `pnpm build:site` | Built the project page with both exported viewers under it |

The 4 skipped runs are the two tests of the look ahead on WebKit and Firefox. It answers a
mouse over the timeline, and Chromium runs both.

This shows a clean checkout works here. It was not repeated on a second machine.
