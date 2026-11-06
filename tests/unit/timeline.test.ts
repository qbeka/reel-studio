import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import { SeekController, type SeekResult } from '../../src/core/seek';
import { ReplayError, Timeline, compareEntries } from '../../src/core/timeline';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { entry, frozen, hashState, outcome, referenceHashAt } from './helpers';

const scene = frozen(receiptAdapter);
const seed = 5;

/** A cycle of real edits. Every pass changes the ledger. */
function realisticLog(rounds: number): LogEntry[] {
  const log: LogEntry[] = [];
  let t = 0;
  let requestId = 1;
  for (let round = 0; round < rounds; round++) {
    const mina = 2000 + (round % 50) * 100;
    log.push(entry((t += 3), 'addReceipt'));
    log.push(entry((t += 3), 'selectExpense', { id: `e${(round % 3) + 1}` }));
    log.push(entry((t += 3), 'setSplitMode', { mode: 'percent' }));
    log.push(entry((t += 3), 'setSplit', { member: 'mina', value: mina }));
    log.push(entry((t += 3), 'setSplit', { member: 'theo', value: 10000 - mina - 1000 }));
    log.push(entry((t += 3), 'setSplit', { member: 'ana', value: 1000 }));
    log.push(entry((t += 3), 'confirmEdit'));
    log.push(outcome((t += 3), 'saveResult', { requestId: requestId++, ok: true }));
  }
  return log;
}

describe('event order', () => {
  it('orders by time and falls back to seq for equal times', () => {
    const a = { seq: 2, t: 10, type: 'x', payload: {}, source: 'user' } as const;
    const b = { seq: 1, t: 10, type: 'x', payload: {}, source: 'user' } as const;
    const c = { seq: 0, t: 11, type: 'x', payload: {}, source: 'user' } as const;
    expect([c, a, b].sort(compareEntries).map((e) => e.seq)).toEqual([1, 2, 0]);
  });
});

describe('countAt', () => {
  const log = [entry(10, 'addReceipt'), entry(20, 'addReceipt'), entry(20, 'addReceipt'), entry(30, 'addReceipt')];
  const timeline = new Timeline(scene, log, { seed, checkpointEvery: 2 });

  it.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [19, 1],
    [20, 3],
    [29, 3],
    [30, 4],
    [1000, 4],
  ])('at %i ms it counts %i commands', (time, count) => {
    expect(timeline.countAt(time)).toBe(count);
  });
});

describe('checkpointed seeking', () => {
  const log = realisticLog(40);

  it('matches replay from the start at every position, in a scrambled order', () => {
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: 16 });
    const positions = Array.from({ length: log.length + 1 }, (_, i) => i);
    // A fixed multiplicative walk visits every position out of order.
    const step = 37;
    for (let i = 0; i < positions.length; i++) {
      const count = (i * step) % positions.length;
      const hash = hashState(scene, timeline.stateAfter(count));
      expect(hash, `position ${count}`).toBe(referenceHashAt(scene, log, seed, count));
    }
  });

  it('bounds the work of a warm seek by the interval', () => {
    const every = 16;
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: every });
    timeline.stateAfter(log.length);
    for (const count of [0, 1, 15, 16, 17, 100, 255, log.length]) {
      const before = timeline.applied;
      timeline.stateAfter(count);
      expect(timeline.applied - before).toBeLessThan(every);
    }
  });

  it('bounds the number of stored states', () => {
    const every = 16;
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: every });
    timeline.stateAfter(log.length);
    expect(timeline.checkpointCount).toBeLessThanOrEqual(Math.ceil(log.length / every) + 1);
  });

  it('with checkpoints off, replays from the start every time', () => {
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: Number.POSITIVE_INFINITY });
    timeline.stateAfter(log.length);
    const before = timeline.applied;
    timeline.stateAfter(log.length);
    expect(timeline.applied - before).toBe(log.length);
    expect(timeline.checkpointCount).toBe(1);
  });

  it('reports an impossible command instead of guessing', () => {
    const bad = [entry(0, 'setSplit', { member: 'mina', value: 1 })];
    const timeline = new Timeline(scene, bad, { seed, checkpointEvery: 16 });
    expect(() => timeline.stateAfter(1)).toThrow(ReplayError);
  });
});

describe('seek controller', () => {
  const log = realisticLog(40);

  function deferredYield() {
    const waiting: (() => void)[] = [];
    return {
      yieldToHost: () => new Promise<void>((resolve) => waiting.push(resolve)),
      release: async () => {
        for (const resume of waiting.splice(0)) resume();
        await Promise.resolve();
        await Promise.resolve();
      },
      get waiting() {
        return waiting.length;
      },
    };
  }

  it('commits a warm seek synchronously', () => {
    const commits: SeekResult<unknown>[] = [];
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: 16 });
    const controller = new SeekController(timeline, (r) => commits.push(r), { sliceBudget: 64 });
    controller.request(9);
    expect(commits).toHaveLength(1);
  });

  it('never commits a stale seek, whichever finishes first', async () => {
    const pause = deferredYield();
    const commits: SeekResult<unknown>[] = [];
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: 16 });
    const controller = new SeekController(timeline, (r) => commits.push(r), {
      sliceBudget: 8,
      yieldToHost: pause.yieldToHost,
    });

    const late = log.at(-1)!.t;
    controller.request(late); // Cold, so this takes many slices.
    expect(commits).toHaveLength(0);
    controller.request(9); // Newer and cheap. It commits at once.
    expect(commits.map((c) => c.time)).toEqual([9]);

    while (pause.waiting > 0) await pause.release();
    expect(commits.map((c) => c.time)).toEqual([9]);
  });

  it('commits only the newest of many cold requests, with a state that matches it', async () => {
    const pause = deferredYield();
    const commits: SeekResult<unknown>[] = [];
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: 16 });
    const controller = new SeekController(timeline, (r) => commits.push(r), {
      sliceBudget: 4,
      yieldToHost: pause.yieldToHost,
    });

    const end = log.at(-1)!.t;
    for (const fraction of [0.5, 0.7, 0.9, 0.6, 0.8]) controller.request(Math.round(end * fraction));
    while (pause.waiting > 0) await pause.release();

    expect(commits).toHaveLength(1);
    const commit = commits[0]!;
    expect(commit.time).toBe(Math.round(end * 0.8));
    expect(hashState(scene, commit.state)).toBe(referenceHashAt(scene, log, seed, commit.count));
  });

  it('keeps checkpoints from a seek that was abandoned', async () => {
    const pause = deferredYield();
    const timeline = new Timeline(scene, log, { seed, checkpointEvery: 16 });
    const controller = new SeekController(timeline, () => {}, {
      sliceBudget: 64,
      yieldToHost: pause.yieldToHost,
    });
    controller.request(log.at(-1)!.t);
    controller.cancel();
    while (pause.waiting > 0) await pause.release();
    expect(timeline.checkpointCount).toBeGreaterThan(1);
  });

  it('reports a replay failure to the latest request', () => {
    const errors: unknown[] = [];
    const bad = [entry(0, 'confirmEdit')];
    const timeline = new Timeline(scene, bad, { seed, checkpointEvery: 16 });
    const controller = new SeekController(timeline, () => {}, {}, (e) => errors.push(e));
    controller.request(0);
    expect(errors[0]).toBeInstanceOf(ReplayError);
    expect(controller.pending).toBe(false);
  });
});
