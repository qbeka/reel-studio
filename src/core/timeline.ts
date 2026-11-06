import type { AnyAdapter, LogEntry } from './adapter';

/** Total order on log entries. Equal timestamps fall back to `seq`, which is unique. */
export function compareEntries(a: LogEntry, b: LogEntry): number {
  return a.t - b.t || a.seq - b.seq;
}

/** A log entry that its state refuses. A validated project never produces one. */
export class ReplayError extends Error {
  constructor(
    readonly entry: LogEntry,
    readonly reason: string,
  ) {
    super(`Command ${entry.seq} (${entry.type}) at ${entry.t} ms cannot run: ${reason}`);
  }
}

export interface TimelineOptions {
  seed: number;
  /**
   * Keep the state after every N commands. A warm seek applies at most N - 1 commands.
   * `Infinity` turns checkpoints off, which is the baseline used in benchmarks: every
   * seek then replays from the initial state through this same code.
   */
  checkpointEvery: number;
}

/**
 * The most states a timeline stores. A long log with a small interval would otherwise
 * store a full state per few commands, and a state can be large. A file sets the interval,
 * so this limit is what keeps that choice from exhausting memory.
 */
export const MAX_CHECKPOINTS = 1024;

/** A resumable position in a replay. */
export interface Cursor<S> {
  state: S;
  count: number;
}

/**
 * Reconstructs scene state at any point in a sorted log.
 *
 * Invariants:
 * - `log` is sorted by `compareEntries` and is never modified.
 * - `checkpoints[i]` is the state after exactly `i * checkpointEvery` commands.
 * - Stored states are shared by reference. This is safe because `apply` must not mutate,
 *   and the tests deep-freeze every state to enforce that. Sharing also means a checkpoint
 *   usually costs only what changed since the previous one.
 * - At most MAX_CHECKPOINTS + 1 checkpoints exist, so memory is bounded by state size.
 *   When a log would need more, the interval widens to fit.
 */
export class Timeline<S = any> {
  readonly log: readonly LogEntry[];
  /** Commands applied since construction. Tests use it to prove the work bound. */
  applied = 0;
  private readonly checkpoints: (S | undefined)[];
  private readonly every: number;

  constructor(
    readonly adapter: AnyAdapter,
    log: readonly LogEntry[],
    options: TimelineOptions,
  ) {
    this.log = log;
    this.every = Math.max(options.checkpointEvery, Math.ceil(log.length / MAX_CHECKPOINTS));
    this.checkpoints = [adapter.init(options.seed)];
  }

  get length(): number {
    return this.log.length;
  }

  get checkpointCount(): number {
    return this.checkpoints.reduce<number>((n, s) => (s === undefined ? n : n + 1), 0);
  }

  /** The stored states, for measuring checkpoint storage. */
  storedStates(): S[] {
    return this.checkpoints.filter((s): s is NonNullable<typeof s> => s !== undefined) as S[];
  }

  /** How many commands have `t <= time`. Binary search over the sorted log. */
  countAt(time: number): number {
    let low = 0;
    let high = this.log.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.log[mid]!.t <= time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** The closest stored state at or before `count`. */
  startFor(count: number): Cursor<S> {
    if (Number.isFinite(this.every)) {
      for (let i = Math.floor(count / this.every); i > 0; i--) {
        const state = this.checkpoints[i];
        if (state !== undefined) return { state, count: i * this.every };
      }
    }
    return { state: this.checkpoints[0] as S, count: 0 };
  }

  /**
   * Applies up to `budget` commands toward `target` and stores checkpoints it crosses.
   * Returns true when the cursor reached `target`.
   */
  advance(cursor: Cursor<S>, target: number, budget = Number.POSITIVE_INFINITY): boolean {
    const end = Math.min(target, cursor.count + budget);
    const { adapter, log, every } = this;
    let state = cursor.state;
    let count = cursor.count;
    while (count < end) {
      const entry = log[count]!;
      const problem = adapter.precondition(state, entry);
      if (problem !== null) throw new ReplayError(entry, problem);
      state = adapter.apply(state, entry, { t: entry.t });
      count++;
      this.applied++;
      if (count % every === 0) this.checkpoints[count / every] = state;
    }
    cursor.state = state;
    cursor.count = count;
    return count >= target;
  }

  /** State after exactly `count` commands, computed synchronously. */
  stateAfter(count: number): S {
    const cursor = this.startFor(count);
    this.advance(cursor, count);
    return cursor.state;
  }

  /** State at logical time `time`. */
  stateAt(time: number): S {
    return this.stateAfter(this.countAt(time));
  }
}
