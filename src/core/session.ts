import type { AnyAdapter, Command, LogEntry, Payload } from './adapter';

/** Time and timers, injected so tests can run a live session without real waiting. */
export interface SessionHost {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const browserHost: SessionHost = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SendResult = { ok: true; entry: LogEntry } | { ok: false; reason: string };

export interface SessionOptions<S> {
  adapter: AnyAdapter;
  host: SessionHost;
  state: S;
  /** Logical time of the session's first moment. */
  startT: number;
  /** Next free `seq`. */
  startSeq: number;
  /** Runs after every accepted command, including delayed outcomes. */
  onChange: (state: S, entry: LogEntry) => void;
}

/**
 * A scene running live. Recording and a viewer's branch are the same thing: commands are
 * validated, applied and logged, and each may schedule outcomes from the local fixture
 * service. Playback never creates a session, which is why it cannot run an effect.
 */
export class LiveSession<S = any> {
  state: S;
  readonly log: LogEntry[] = [];
  private readonly timers = new Set<unknown>();
  private readonly startedAt: number;
  private nextSeq: number;
  private closed = false;

  constructor(private readonly options: SessionOptions<S>) {
    this.state = options.state;
    this.nextSeq = options.startSeq;
    this.startedAt = options.host.now();
  }

  /** Current logical time. Whole milliseconds, as stored in the log. */
  get t(): number {
    const elapsed = this.options.host.now() - this.startedAt;
    return this.options.startT + Math.max(0, Math.round(elapsed));
  }

  send(type: string, payload: Payload = {}): SendResult {
    return this.accept({ type, payload }, 'user');
  }

  /** Stops the session. Outcomes still scheduled are dropped and never reach the log. */
  close(): void {
    this.closed = true;
    for (const handle of this.timers) this.options.host.clearTimer(handle);
    this.timers.clear();
  }

  private accept(command: Command, source: LogEntry['source']): SendResult {
    if (this.closed) return { ok: false, reason: 'This session has ended.' };
    const { adapter, host, onChange } = this.options;
    if (!adapter.commandTypes.includes(command.type)) {
      return { ok: false, reason: `Unknown command ${command.type}.` };
    }
    const reason =
      adapter.parse(command.type, command.payload) ?? adapter.precondition(this.state, command);
    if (reason !== null) return { ok: false, reason };

    const entry: LogEntry = { ...command, seq: this.nextSeq++, t: this.t, source };
    const before = this.state;
    this.state = adapter.apply(before, entry, { t: entry.t });
    this.log.push(entry);

    for (const effect of adapter.effects?.(this.state, entry) ?? []) {
      const handle: unknown = host.setTimer(() => {
        this.timers.delete(handle);
        this.accept(effect.command, 'outcome');
      }, effect.delayMs);
      this.timers.add(handle);
    }
    onChange(this.state, entry);
    return { ok: true, entry };
  }
}
