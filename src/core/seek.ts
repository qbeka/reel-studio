import type { Timeline } from './timeline';

export interface SeekResult<S> {
  time: number;
  count: number;
  state: S;
}

export interface SeekOptions {
  /** Most commands applied before giving the browser a turn. */
  sliceBudget: number;
  /** Returns control to the event loop. Tests inject their own to force interleaving. */
  yieldToHost: () => Promise<void>;
}

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
 * A warm seek finishes inside one slice and commits before `request` returns. A cold seek
 * through a long log takes several slices, so a newer request can arrive in the middle.
 * The older seek notices at its next slice boundary and stops. `onCommit` runs only for
 * the latest request and only with a complete state, so a stale or half-built state never
 * reaches the screen.
 *
 * Work done by an abandoned seek is not wasted, because any checkpoints it crossed remain
 * in the timeline.
 */
export class SeekController<S> {
  private latest = 0;
  private readonly sliceBudget: number;
  private readonly yieldToHost: () => Promise<void>;

  constructor(
    private readonly timeline: Timeline<S>,
    private readonly onCommit: (result: SeekResult<S>) => void,
    options: Partial<SeekOptions> = {},
    private readonly onError: (error: unknown) => void = (error) => {
      throw error;
    },
  ) {
    this.sliceBudget = options.sliceBudget ?? 4000;
    this.yieldToHost = options.yieldToHost ?? defaultYield;
  }

  /** True while a request has not committed yet. */
  pending = false;

  request(time: number): void {
    const token = ++this.latest;
    this.pending = true;
    const target = this.timeline.countAt(time);
    const cursor = this.timeline.startFor(target);
    try {
      if (this.timeline.advance(cursor, target, this.sliceBudget)) {
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
        if (this.timeline.advance(cursor, target, this.sliceBudget)) break;
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
