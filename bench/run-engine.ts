/**
 * Engine timing in Node, with no browser and no rendering. This is the smoke benchmark,
 * for quick feedback during development. Published latency comes from bench/run-browser.ts.
 *
 *   pnpm bench:smoke
 */
import { performance } from 'node:perf_hooks';
import { Timeline } from '../src/core/timeline';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import { fastHash } from './harness';
import { WORKLOADS, receiptLog } from './fixtures';

const smoke = process.argv.includes('--smoke');
const INTERVAL = 256;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: Number(percentile(sorted, 0.5).toFixed(3)),
    p95: Number(percentile(sorted, 0.95).toFixed(3)),
    max: Number(sorted.at(-1)!.toFixed(3)),
  };
}

for (const [name, spec] of Object.entries(WORKLOADS)) {
  const log = receiptLog(spec);
  const seedTime = performance.now();
  const full = new Timeline(receiptAdapter, log, { seed: spec.seed, checkpointEvery: INTERVAL });
  const final = full.stateAfter(log.length);
  const replayMs = performance.now() - seedTime;

  const positions = Array.from({ length: smoke ? 200 : 2000 }, (_, i) => log[(i * 7919) % log.length]!.t);
  const warm: number[] = [];
  for (const t of positions) {
    const start = performance.now();
    full.stateAt(t);
    warm.push(performance.now() - start);
  }

  const baseline = new Timeline(receiptAdapter, log, {
    seed: spec.seed,
    checkpointEvery: Number.POSITIVE_INFINITY,
  });
  const replay: number[] = [];
  for (const t of positions.slice(0, smoke ? 20 : 100)) {
    const start = performance.now();
    baseline.stateAt(t);
    replay.push(performance.now() - start);
  }

  // A fairer player with no checkpoints: it keeps its position and only restarts to go
  // backward. Forward seeks are cheap for it and backward seeks cost a full replay.
  const resumer = new Timeline(receiptAdapter, log, {
    seed: spec.seed,
    checkpointEvery: Number.POSITIVE_INFINITY,
  });
  let cursor = resumer.startFor(0);
  const resuming: number[] = [];
  for (const t of positions.slice(0, smoke ? 20 : 100)) {
    const start = performance.now();
    const target = resumer.countAt(t);
    if (target < cursor.count) cursor = resumer.startFor(0);
    resumer.advance(cursor, target);
    resuming.push(performance.now() - start);
  }

  const bytes = JSON.stringify(receiptAdapter.serialize(final)).length;
  console.log(
    JSON.stringify({
      workload: name,
      commands: log.length,
      receipts: final.expenses.length,
      stateBytes: bytes,
      fullReplayMs: Number(replayMs.toFixed(1)),
      checkpoints: full.checkpointCount,
      warmSeekMs: summarize(warm),
      replaySeekMs: summarize(replay),
      forwardResumeSeekMs: summarize(resuming),
      finalHash: fastHash(receiptAdapter, final).slice(0, 12),
    }),
  );
}
