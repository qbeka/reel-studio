import type { LogEntry } from '../src/core/adapter';
import { nextRandom } from '../src/core/random';

/**
 * Seek positions from command timestamps, so every seek lands on real work. Times are
 * distinct and uniformly shuffled. A log with fewer distinct times than `count` uses them
 * all. Protocol 1 used a linear congruential generator here, and `x % n` on its weak low
 * bits skewed the sample toward early, cheap states.
 */
export function seededTimes(log: readonly LogEntry[], count: number, seed: number): number[] {
  const times = [...new Set(log.map((c) => c.t))];
  let rng = seed | 0;
  for (let i = times.length - 1; i > 0; i--) {
    const draw = nextRandom(rng);
    rng = draw.rng;
    const j = Math.floor(draw.value * (i + 1));
    [times[i], times[j]] = [times[j]!, times[i]!];
  }
  return times.slice(0, count);
}

/** Where a sample falls in the log, as fractions of its length in commands. */
export function positionQuantiles(log: readonly LogEntry[], times: readonly number[]) {
  const index = new Map(log.map((c, i) => [c.t, i]));
  const sorted = times.map((t) => (index.get(t) ?? 0) / log.length).sort((a, b) => a - b);
  const at = (q: number) => Number(sorted[Math.floor(q * (sorted.length - 1))]!.toFixed(3));
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}
