import { describe, expect, it } from 'vitest';
import type { AnyAdapter, LogEntry } from '../../src/core/adapter';
import { diffFields, diffJson, diffStates } from '../../src/core/diff';
import { Timeline } from '../../src/core/timeline';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { retryAdapter } from '../../src/scenes/retry-queue/adapter';
import recording from '../../projects/receipt-split-release.reel.json';
import retries from '../../projects/retry-queue.reel.json';
import { deepFreeze, entry, hashState } from './helpers';

describe('diffJson', () => {
  it('finds nothing in equal values, whatever order their keys came in', () => {
    expect(diffJson({ a: 1, b: [1, 2, { c: null }] }, { b: [1, 2, { c: null }], a: 1 })).toEqual([]);
  });

  it('names each place that differs by its path', () => {
    const changes = diffJson(
      { draft: { values: { ana: 3000, mina: 5000 } }, view: 'receipt', list: [1, 2] },
      { draft: { values: { ana: 1000, mina: 5000 } }, view: 'balances', list: [1, 2, 3] },
    );
    expect(changes).toEqual([
      { id: 'draft.values.ana', label: 'draft.values.ana', before: '3000', after: '1000' },
      { id: 'list[2]', label: 'list[2]', before: null, after: '3' },
      { id: 'view', label: 'view', before: 'receipt', after: 'balances' },
    ]);
  });

  it('treats a value that changed kind as one change, not a walk into both', () => {
    expect(diffJson({ a: { b: 1 } }, { a: null })).toEqual([{ id: 'a', label: 'a', before: '{"b":1}', after: 'null' }]);
  });

  it('stops at its limit', () => {
    const a = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 0]));
    const b = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 1]));
    expect(diffJson(a, b, 7)).toHaveLength(7);
  });
});

describe('diffFields', () => {
  const field = (id: string, value: string) => ({ id, label: id.toUpperCase(), value });

  it('reports changed, new and missing fields, and leaves equal ones out', () => {
    expect(
      diffFields([field('a', '1'), field('b', '2'), field('gone', 'x')], [field('a', '1'), field('b', '3'), field('new', 'y')]),
    ).toEqual([
      { id: 'b', label: 'B', before: '2', after: '3' },
      { id: 'new', label: 'NEW', before: null, after: 'y' },
      { id: 'gone', label: 'GONE', before: 'x', after: null },
    ]);
  });
});

describe('what changed between two moments', () => {
  const log = recording.commands as LogEntry[];
  const timeline = new Timeline(receiptAdapter, log, { seed: recording.seed, checkpointEvery: 256 });

  it('is nothing between a state and itself, or a state and its equal', () => {
    const state = timeline.stateAt(9000);
    expect(diffStates(receiptAdapter, state, state)).toEqual([]);
    const copy = receiptAdapter.restore(structuredClone(receiptAdapter.serialize(state)), 1);
    expect(diffStates(receiptAdapter, state, copy)).toEqual([]);
  });

  it('reads as the screen does: the share that was lowered, and what followed from it', () => {
    const changes = diffStates(receiptAdapter, timeline.stateAt(12_000), timeline.stateAt(13_000));
    const byId = Object.fromEntries(changes.map((change) => [change.id, change]));
    expect(byId['share:ana']).toMatchObject({ label: 'Ana share', before: '30%', after: '10%' });
    expect(byId.sum).toMatchObject({ before: '120%', after: '100%' });
    expect(byId.save).toMatchObject({ before: 'Refused', after: 'Not saved yet' });
    expect(byId['preview:ana']).toMatchObject({ before: null, after: 'Owed $59.85' });
    // Nothing was saved in between, so the ledger's own balances have not moved.
    expect(byId['balance:ana']).toBeUndefined();
    expect(byId.view).toBeUndefined();
  });

  it('finds a difference exactly when the hashes differ, at every pair of commands', () => {
    for (const adapter of [receiptAdapter, retryAdapter] as AnyAdapter[]) {
      const source = adapter === receiptAdapter ? recording : retries;
      const line = new Timeline(adapter, source.commands as LogEntry[], { seed: source.seed, checkpointEvery: 4 });
      const states = Array.from({ length: line.length + 1 }, (_, count) => line.stateAfter(count));
      for (let i = 0; i < states.length; i++) {
        for (let j = i; j < states.length; j++) {
          const same = hashState(adapter, states[i]) === hashState(adapter, states[j]);
          const fields = diffStates(adapter, states[i], states[j]);
          // Fields are a reading of the state, so they can only differ if the state does.
          if (same) expect(fields).toEqual([]);
          // The raw comparison is exact in both directions.
          const raw = diffJson(adapter.serialize(states[i]), adapter.serialize(states[j]));
          expect(raw.length === 0).toBe(same);
        }
      }
    }
  });

  it('falls back to paths for a scene that names no fields', () => {
    const plain = { ...receiptAdapter, fields: undefined } as AnyAdapter;
    const changes = diffStates(plain, timeline.stateAt(12_000), timeline.stateAt(13_000));
    expect(changes.map((change) => change.id)).toContain('draft.split.values.ana');
  });

  it('never changes the states it reads', () => {
    const a = deepFreeze(timeline.stateAt(5000));
    const b = deepFreeze(timeline.stateAt(15_000));
    expect(() => diffStates(receiptAdapter, a, b)).not.toThrow();
  });
});

describe('fields', () => {
  it('stay a short fixed list however long the ledger grows', () => {
    let state = receiptAdapter.init(1);
    const before = receiptAdapter.fields!(state).length;
    for (let i = 0; i < 200; i++) state = receiptAdapter.apply(state, entry(i, 'addReceipt'), { t: i });
    expect(receiptAdapter.fields!(state).length).toBe(before);
    expect(receiptAdapter.fields!(state).find((field) => field.id === 'receipts')?.value).toBe('203');
  });

  it('have ids that are unique within a state', () => {
    const state = new Timeline(receiptAdapter, recording.commands as LogEntry[], { seed: 1, checkpointEvery: 256 }).stateAt(13_000);
    const ids = receiptAdapter.fields!(state).map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
