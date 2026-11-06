/**
 * The correctness harness. It compares checkpointed seeks with replay from the start at
 * declared positions. Benchmarks and negative controls share this code, so a control that
 * trips here shows the harness would have caught the real thing.
 */
import { createHash } from 'node:crypto';
import type { AnyAdapter, LogEntry } from '../src/core/adapter';
import { canonicalJson } from '../src/core/canonical';
import { Timeline } from '../src/core/timeline';

export const fastHash = (adapter: AnyAdapter, state: unknown): string =>
  createHash('sha256').update(canonicalJson(adapter.serialize(state))).digest('hex');

/**
 * Times worth checking: right before and after commands, at equal timestamps, around each
 * checkpoint boundary, the ends, and a seeded spread. Results are sorted and unique.
 */
export function seekPositions(
  log: readonly LogEntry[],
  checkpointEvery: number,
  spread: number,
  seed: number,
): number[] {
  const times = new Set<number>([0, log.at(-1)!.t, log.at(-1)!.t + 1]);
  const addAround = (t: number) => {
    if (t > 0) times.add(t - 1);
    times.add(t);
    times.add(t + 1);
  };
  for (let i = 0; i < log.length; i += checkpointEvery) {
    for (const j of [i - 1, i, i + 1]) {
      const entry = log[j];
      if (entry !== undefined) addAround(entry.t);
    }
  }
  for (let i = 1; i < log.length; i++) {
    if (log[i]!.t === log[i - 1]!.t) addAround(log[i]!.t);
  }
  let x = seed >>> 0;
  for (let i = 0; i < spread; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    addAround(log[x % log.length]!.t);
  }
  return [...times].sort((a, b) => a - b);
}

export interface SeekCheck {
  positions: number;
  mismatches: { t: number; expected: string; actual: string }[];
}

/**
 * Hashes the reference state at every position in one forward pass, which keeps the check
 * linear. It then seeks a checkpointed timeline to the same positions in a scrambled
 * order, so each seek starts from whatever a previous one left behind.
 */
export function checkSeeking(
  adapter: AnyAdapter,
  log: readonly LogEntry[],
  seed: number,
  checkpointEvery: number,
  positions: readonly number[],
  makeTimeline: (adapter: AnyAdapter, log: readonly LogEntry[]) => Timeline = (a, l) =>
    new Timeline(a, l, { seed, checkpointEvery }),
): SeekCheck {
  const reference = new Map<number, string>();
  let state = adapter.init(seed);
  let index = 0;
  for (const t of positions) {
    while (index < log.length && log[index]!.t <= t) {
      const entry = log[index]!;
      state = adapter.apply(state, entry, { t: entry.t });
      index++;
    }
    reference.set(t, fastHash(adapter, state));
  }

  const scrambled = [...positions];
  let x = 0x9e3779b9;
  for (let i = scrambled.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [scrambled[i], scrambled[j]] = [scrambled[j]!, scrambled[i]!];
  }

  const timeline = makeTimeline(adapter, log);
  const mismatches: SeekCheck['mismatches'] = [];
  for (const t of scrambled) {
    const expected = reference.get(t)!;
    try {
      const actual = fastHash(adapter, timeline.stateAt(t));
      if (actual !== expected) mismatches.push({ t, expected, actual });
    } catch (error) {
      // A replay that refuses a command is a failure of the seek, with a clear reason.
      mismatches.push({ t, expected, actual: String((error as Error).message) });
    }
  }
  return { positions: positions.length, mismatches };
}
