# Benchmark protocol

Frozen before the final measurement. A change to anything here after that run means a new
protocol version and a new run. The earlier results stay in `runs/`.

Version: 1

## Question

How long does a viewer wait for a coherent state after asking for a position in a story,
and what do checkpoints buy compared with replaying from the start?

## Primary metric and pass criterion

**Seek to coherent state**: the time from dispatching one `input` event on the slider of
the exported viewer until the page shows `data-seeking="false"` with `data-t` equal to the
requested time. `data-t` and the scene are written in the same React commit, so at that
moment the DOM holds the requested state. It excludes the paint that follows.

Pass criterion: on the `stress` workload, in the `checkpointed` variant, warm seeks, the
p95 of **each** of 5 independent runs is below 100 ms on the reference machine.

## Secondary metrics

| Metric | Definition |
|---|---|
| Next frame | Same start, ending at the first `requestAnimationFrame` callback after the commit. This does not prove the frame was displayed. |
| Cold seek | The first seek in a fresh page, right after the viewer appears, to 25, 50, 75 and 100 percent of the log. The background walk may still be running. |
| Ready | From navigation until the slider exists. |
| Heap | `Runtime.getHeapUsage` used size after a forced collection, at the end of a run. |
| Checkpoint overhead | Heap of `checkpointed` minus heap of `baseline`, per run, on the same workload. |
| Scrub | Seek requests sent every 16 ms without waiting. Reports requests, commits and total time. |
| Export time | `pnpm export` wall time, 5 repetitions, one process each. |
| Bundle size | Total bytes in the export, and gzip bytes of JS and CSS. |

## Workloads

Every workload uses the `receipt-split` scene, version 1.

| Name | Label | Commands | Receipts | Seed | Source |
|---|---|---|---|---|---|
| `short` | Realistic | From the release recording | 3 | From the project | Recorded through the editor |
| `long` | Long authoring session, generated | 2,000 | About 120 | 20 | `bench/fixtures.ts` |
| `stress` | Stress, generated, not a user workflow | 20,000 | About 2,000 | 21 | `bench/fixtures.ts` |

The generated logs model a person: add receipts, open one, change a split, sometimes fail
validation, correct it, save, read balances. They are not no-ops. The manifest records the
command mix and the share of sampled positions where the state changed.

A setSplit or addReceipt recomputes balances over the whole ledger, so state size drives
command cost. The manifest records final state size.

## Variants

| Variant | Setting |
|---|---|
| `checkpointed` | `checkpointEvery` 256 commands |
| `baseline` | `checkpointEvery` 100000, which is above every log length, so only the initial state is stored |

Both are the same viewer, reducer, render and machine. The only difference is one number
in the project file. Nothing is disabled in the baseline. It replays from the start through
the same code.

## Procedure

1. `pnpm build`, then export each workload and variant once.
2. For each of 5 runs, in order: for each workload and variant, start a fresh headless
   Chromium process.
3. Cold: open a fresh page per position, seek once.
4. Warm: open one page. Warmup is 40 seeded seeks plus a seek to the end. These samples
   are discarded. Measure 300 seeded seeks, or 30 for `baseline`, since each takes seconds.
   A workload with too few distinct times uses all of them.
5. Scrub 120 positions, then check 12 positions against a replay in Node.
6. Force a collection and read the heap.

Seek positions come from command timestamps through a linear congruential generator with
seed bases 1000 (warmup), 2000 (warm), 3000 (scrub) and 4000 (coherence), plus the run
number. Consecutive equal times are skipped, because a seek to the current time does nothing.

## Reporting

- Report each run's p50, p95 and max, then the median and range of the run level p95.
  Samples within a run are not independent experiments, so `n` for the headline is 5.
- Keep every sample in `raw/`. No sample is excluded. Any exclusion would be listed in
  the manifest.
- Report the load average recorded with each run.
- A coherence check below 100 percent invalidates that run.

## Reference machine

Apple M5 Pro, 15 logical cores or as reported in the manifest, 48 GB, macOS, on AC power.
Viewport 1440 by 900 at device scale 1. Headless Chromium from Playwright, version in the
manifest.

## Limits, stated before measuring

Lab timings in headless Chromium on one laptop. This is not field INP. Other work may share
the machine, and the load average shows how much. A `requestAnimationFrame` callback does
not prove a frame reached the display. The stress log is a synthetic extreme, not a
recording anyone would watch.
