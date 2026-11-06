Final measurement, protocol 3 in `bench/PROTOCOL.md`, at the commit in `manifest.json`.

- `raw/`: every sample, one file per run, workload and variant.
- `summary.json`: run level statistics from `bench/summarize.ts`.
- `engine.jsonl`: Node engine timing, including the forward resume comparison.
- `export.json`: export time and bundle sizes.
- `correctness.json`: seek checks, oracle checks and negative controls.
- `mutants.json`: each seeded mutant and the test that killed it.
