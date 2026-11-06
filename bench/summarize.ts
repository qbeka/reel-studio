/**
 * Reduces raw samples to run level statistics. Each run is one independent observation,
 * so the headline is the median and range across runs, never a pooled percentile.
 * Every number in docs/REPORT.md comes from the summary.json this writes.
 *
 *   pnpm exec tsx bench/summarize.ts runs/<folder>
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) {
  console.error('Usage: pnpm exec tsx bench/summarize.ts <run folder>');
  process.exit(2);
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

const round = (value: number) => Number(value.toFixed(2));

function acrossRuns(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    median: round(sorted[Math.floor((sorted.length - 1) / 2)]!),
    min: round(sorted[0]!),
    max: round(sorted.at(-1)!),
    perRun: values.map(round),
  };
}

interface RunRecord {
  run: number;
  workload: string;
  variant: string;
  readyMs: number;
  loadAverage: number[];
  warm: { commit: number; nextFrame: number }[];
  cold: { position: number; commit: number }[];
  scrub: { requested: number; committed: number; totalMs: number };
  coherentChecks: { passed: number; total: number };
  heapUsedBytes: number;
}

const records: RunRecord[] = [];
for (const file of await readdir(join(dir, 'raw'))) {
  records.push(JSON.parse(await readFile(join(dir, 'raw', file), 'utf8')));
}

const groups = new Map<string, RunRecord[]>();
for (const record of records) {
  const key = `${record.workload}/${record.variant}`;
  groups.set(key, [...(groups.get(key) ?? []), record]);
}

const summary: { [key: string]: unknown }[] = [];
for (const [key, group] of [...groups].sort()) {
  group.sort((a, b) => a.run - b.run);
  const [workload, variant] = key.split('/');
  summary.push({
    workload,
    variant,
    warmSamplesPerRun: group[0]!.warm.length,
    warmP50Ms: acrossRuns(group.map((r) => quantile(r.warm.map((s) => s.commit), 0.5))),
    warmP95Ms: acrossRuns(group.map((r) => quantile(r.warm.map((s) => s.commit), 0.95))),
    warmMaxMs: acrossRuns(group.map((r) => Math.max(...r.warm.map((s) => s.commit)))),
    nextFrameP95Ms: acrossRuns(group.map((r) => quantile(r.warm.map((s) => s.nextFrame), 0.95))),
    coldWorstMs: acrossRuns(group.map((r) => Math.max(...r.cold.map((s) => s.commit)))),
    coldMedianMs: acrossRuns(group.map((r) => quantile(r.cold.map((s) => s.commit), 0.5))),
    readyMs: acrossRuns(group.map((r) => r.readyMs)),
    heapMB: acrossRuns(group.map((r) => r.heapUsedBytes / 1e6)),
    scrubCommits: group.map((r) => `${r.scrub.committed}/${r.scrub.requested}`),
    scrubTotalMs: acrossRuns(group.map((r) => r.scrub.totalMs)),
    coherent: `${group.reduce((n, r) => n + r.coherentChecks.passed, 0)}/${group.reduce((n, r) => n + r.coherentChecks.total, 0)}`,
    loadAverage1m: acrossRuns(group.map((r) => r.loadAverage[0]!)),
  });
}

await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of summary) {
  const p95 = row.warmP95Ms as { median: number; min: number; max: number };
  console.log(`${row.workload}/${row.variant}: warm p95 ${p95.median} (${p95.min} to ${p95.max}) ms, coherent ${row.coherent}`);
}
