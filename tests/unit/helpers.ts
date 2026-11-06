import type { AnyAdapter, LogEntry } from '../../src/core/adapter';
import { hashJson } from '../../src/core/sha256';
import { Timeline } from '../../src/core/timeline';

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Wraps an adapter so that any mutation of a state throws in strict mode. */
export function frozen(adapter: AnyAdapter): AnyAdapter {
  return {
    ...adapter,
    init: (seed) => deepFreeze(adapter.init(seed)),
    apply: (state, command, clock) => deepFreeze(adapter.apply(state, command, clock)),
  };
}

export function hashState(adapter: AnyAdapter, state: unknown): string {
  return hashJson(adapter.serialize(state));
}

/** The reference: replay from the initial state with no checkpoints at all. */
export function referenceHashAt(
  adapter: AnyAdapter,
  log: readonly LogEntry[],
  seed: number,
  count: number,
): string {
  const timeline = new Timeline(adapter, log, {
    seed,
    checkpointEvery: Number.POSITIVE_INFINITY,
  });
  return hashState(adapter, timeline.stateAfter(count));
}

let nextSeq = 1;
export function entry(t: number, type: string, payload: LogEntry['payload'] = {}): LogEntry {
  return { seq: nextSeq++, t, type, payload, source: 'user' };
}

export function outcome(t: number, type: string, payload: LogEntry['payload'] = {}): LogEntry {
  return { seq: nextSeq++, t, type, payload, source: 'outcome' };
}
