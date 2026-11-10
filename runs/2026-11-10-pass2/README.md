Protocol 3 in `bench/PROTOCOL.md`, measured a third time after the second redesign of the
viewer and both scenes, at the commit in `manifest.json`. The reducers, the commands and the
recorded project did not change, and every state hash in `manifest.json` equals the one in
`runs/2026-11-09-redesign` and `runs/2026-11-06-final`.

The viewer now does more on every commit: the pointer plan includes a press and typed
keys, a close shot veils what is outside its subject, the receipt scene draws a tile for
each person and the balances screen a ledger. This run is the measure of that.

- `raw/`: every sample, one file per run, workload and variant.
- `summary.json`: run level statistics from `bench/summarize.ts`.
- `export.json`: export time and bundle sizes.
- `correctness.json`: seek checks, oracle checks and negative controls.

The date in `manifest.json` is UTC. On the machine's own clock the run was on the evening of
9 November. The build that was measured was made as the run started, at commit `afbae05`.
Two commits landed while it ran, and the manifest names the later one. They change a notice
file and one sentence of the project page, and no file under `src` or `bench`.

The Node engine timing and the mutants were not repeated, because the code they measure did
not change. They stay in `runs/2026-11-06-final`.

Other work shared the machine throughout. The load average recorded with each run was
between 7 and 21 on 18 logical cores.
