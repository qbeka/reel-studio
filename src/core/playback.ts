import { type Cursor, type Timeline } from './timeline';
import { SeekController, type SeekOptions } from './seek';

/** The rendering clock. Injected so tests can step frames by hand. */
export interface FrameHost {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export const browserFrames: FrameHost = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface PlaybackSnapshot<S> {
  /** Logical time to display. During a seek this is the requested time. */
  t: number;
  /** A complete state. It always belongs to a finished seek or to played commands. */
  state: S;
  /** Commands included in `state`. */
  count: number;
  playing: boolean;
  /** True while `state` still shows the previous position. */
  seeking: boolean;
  error: string | null;
}

/**
 * A long gap between frames, such as a hidden tab, must not jump the story ahead. Logical
 * time advances by at most this much per frame, so a viewer comes back to where they were.
 */
const MAX_FRAME_MS = 250;

/**
 * Moves logical time. The rendering clock only decides how quickly it moves. State comes
 * from applying the log in order, so a slow frame changes when a state appears and never
 * which state appears.
 */
export class Playback<S = any> {
  private snapshot: PlaybackSnapshot<S>;
  private readonly listeners = new Set<() => void>();
  private readonly seeker: SeekController<S>;
  private cursor: Cursor<S>;
  private frame: number | null = null;
  private lastFrame: number | null = null;
  private resumeAfterSeek = false;
  /** Resolves when every command has been checked and every checkpoint exists. */
  readonly ready: Promise<void>;

  constructor(
    private readonly timeline: Timeline<S>,
    readonly range: { start: number; end: number },
    private readonly frames: FrameHost = browserFrames,
    seekOptions: Partial<SeekOptions> = {},
  ) {
    this.cursor = { state: timeline.stateAfter(0), count: 0 };
    this.snapshot = {
      t: range.start,
      state: this.cursor.state,
      count: 0,
      playing: false,
      seeking: false,
      error: null,
    };
    this.seeker = new SeekController(
      timeline,
      ({ time, count, state }) => {
        this.cursor = { state, count };
        const resume = this.resumeAfterSeek;
        this.resumeAfterSeek = false;
        this.update({ t: time, state, count, seeking: false });
        if (resume) this.play();
      },
      seekOptions,
      (error) => {
        this.resumeAfterSeek = false;
        this.update({ seeking: false, playing: false, error: String((error as Error).message) });
      },
    );
    if (range.start > 0) this.seek(range.start);
    this.ready = this.seeker.prepare();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PlaybackSnapshot<S> => this.snapshot;

  play(): void {
    if (this.snapshot.playing) return;
    if (this.snapshot.seeking) {
      this.resumeAfterSeek = true;
      return;
    }
    if (this.snapshot.t >= this.range.end) {
      this.seekThenResume(this.range.start, true);
      return;
    }
    this.update({ playing: true });
    this.lastFrame = null;
    this.frame = this.frames.request(this.tick);
  }

  pause(): void {
    this.resumeAfterSeek = false;
    if (this.frame !== null) this.frames.cancel(this.frame);
    this.frame = null;
    if (this.snapshot.playing) this.update({ playing: false });
  }

  seek(time: number): void {
    this.seekThenResume(time, this.snapshot.playing || this.resumeAfterSeek);
  }

  private seekThenResume(time: number, resume: boolean): void {
    this.pause();
    this.resumeAfterSeek = resume;
    const t = Math.round(Math.min(this.range.end, Math.max(this.range.start, time)));
    this.update({ t, seeking: true });
    this.seeker.request(t);
  }

  destroy(): void {
    this.pause();
    this.seeker.close();
    this.listeners.clear();
  }

  private tick = (now: number): void => {
    this.frame = null;
    const elapsed = this.lastFrame === null ? 0 : Math.min(now - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = now;
    const t = Math.min(this.range.end, this.snapshot.t + elapsed);
    const target = this.timeline.countAt(t);
    try {
      this.timeline.advance(this.cursor, target);
    } catch (error) {
      this.update({ playing: false, error: String((error as Error).message) });
      return;
    }
    const playing = t < this.range.end;
    this.update({ t, state: this.cursor.state, count: this.cursor.count, playing });
    if (playing) this.frame = this.frames.request(this.tick);
  };

  private update(change: Partial<PlaybackSnapshot<S>>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}
