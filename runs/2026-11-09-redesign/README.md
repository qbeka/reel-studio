Protocol 3 in `bench/PROTOCOL.md`, measured again after the viewer and the receipt scene
were redrawn, at the commit in `manifest.json`. The reducers, the commands and the recorded
project did not change, and every state hash in `manifest.json` equals the one in
`runs/2026-11-06-final`.

- `raw/`: every sample, one file per run, workload and variant.
- `summary.json`: run level statistics from `bench/summarize.ts`.
- `export.json`: export time and bundle sizes.
- `correctness.json`: seek checks, oracle checks and negative controls.

The Node engine timing and the mutants were not repeated, because the code they measure did
not change. They stay in `runs/2026-11-06-final`.

Other work shared the machine throughout. The load average recorded with each run was
between 7 and 49 on 18 logical cores, and run 4 was the slowest for that reason.
