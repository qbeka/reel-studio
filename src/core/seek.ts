import type { Timeline } from './timeline';

export interface SeekResult<S> {
  time: number;
  count: number;
  state: S;
}

export interface SeekOptions {
  /** Commands applied between looks at the clock. */
  sliceBudget: number;
  /** How long one slice may hold the main thread, in milliseconds. */
  sliceMs: number;
  /** Returns control to the event loop. Tests inject their own to force interleaving. */
  yieldToHost: () => Promise<void>;
  now: () => number;
}

/**
 * Slices are limited by time, not by a command count, because the cost of a command
 * depends on the scene. In the stress log one command can take a fifth of a millisecond.
 */
const SLICE_MS = 10;
const SLICE_BUDGET = 32;

const defaultYield = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

/**
 * Runs seeks so that the newest request wins.
 *
 * A warm seek usually finishes inside one slice and commits before `request` returns. A
 * longer seek takes several slices, so a newer request can arrive in the middle. The older
 * seek notices at its next slice boundary and stops. `onCommit` runs only for the latest
 * request and only with a complete state, so a stale or half-built state never reaches
 * the screen.
 *
 * Work done by an abandoned seek is not wasted, because any checkpoints it crossed remain
 * in the timeline.
 */
export class SeekController<S> {
  private latest = 0;
  private closed = false;
  private readonly sliceBudget: number;
  private readonly sliceMs: number;
  private readonly yieldToHost: () => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly timeline: Timeline<S>,
    private readonly onCommit: (result: SeekResult<S>) => void,
    options: Partial<SeekOptions> = {},
    private readonly onError: (error: unknown) => void = (error) => {
      throw error;
    },
  ) {
    this.sliceBudget = options.sliceBudget ?? SLICE_BUDGET;
    this.sliceMs = options.sliceMs ?? SLICE_MS;
    this.yieldToHost = options.yieldToHost ?? defaultYield;
    this.now = options.now ?? (() => performance.now());
  }

  /** True while a request has not committed yet. */
  pending = false;

  request(time: number): void {
    const token = ++this.latest;
    this.pending = true;
    const target = this.timeline.countAt(time);
    const cursor = this.timeline.startFor(target);
    try {
      if (this.slice(cursor, target)) {
        this.finish({ time, count: target, state: cursor.state });
        return;
      }
    } catch (error) {
      this.fail(error);
      return;
    }
    void this.continue(token, time, target, cursor);
  }

  /** Abandons any running seek, for example when the viewer starts playing. */
  cancel(): void {
    this.latest++;
    this.pending = false;
  }

  /** Stops all work, including `prepare`. */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  /**
   * Walks the whole log in the background. This fills the checkpoints, so later seeks are
   * warm, and it checks every command against the scene. The page paints first, and input
   * stays responsive because the walk gives way after each slice.
   *
   * A viewer's seek matters more, so the walk waits while one is running. On the stress
   * log, sharing the thread made the first seek take over twice as long. A seek also
   * fills checkpoints, so the walk resumes past whatever it covered.
   */
  async prepare(): Promise<void> {
    const cursor = { state: this.timeline.stateAfter(0), count: 0 };
    const target = this.timeline.length;
    try {
      for (;;) {
        if (!this.pending) {
          const best = this.timeline.startFor(target);
          if (best.count > cursor.count) Object.assign(cursor, best);
          if (this.slice(cursor, target)) return;
        }
        await this.yieldToHost();
        if (this.closed) return;
      }
    } catch (error) {
      if (!this.closed) this.fail(error);
    }
  }

  /** Advances until `target`, or until this slice has used its time. */
  private slice(cursor: { state: S; count: number }, target: number): boolean {
    const deadline = this.now() + this.sliceMs;
    do {
      if (this.timeline.advance(cursor, target, this.sliceBudget)) return true;
    } while (this.now() < deadline);
    return false;
  }

  private async continue(
    token: number,
    time: number,
    target: number,
    cursor: { state: S; count: number },
  ): Promise<void> {
    try {
      for (;;) {
        await this.yieldToHost();
        if (token !== this.latest) return;
        if (this.slice(cursor, target)) break;
      }
      this.finish({ time, count: target, state: cursor.state });
    } catch (error) {
      if (token === this.latest) this.fail(error);
    }
  }

  private finish(result: SeekResult<S>): void {
    this.pending = false;
    this.onCommit(result);
  }

  private fail(error: unknown): void {
    this.pending = false;
    this.onError(error);
  }
}
