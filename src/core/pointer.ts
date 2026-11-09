import type { LogEntry } from './adapter';

/**
 * Where the drawn pointer is at a moment of the story.
 *
 * Reel records commands, not pointer movement, so there is no recorded path to play back.
 * The pointer is worked out from the log instead: it rests on the control of the last
 * command, and shortly before the next one it travels to that command's control and
 * arrives as the command happens. It depends only on the log and the time, so playing,
 * scrubbing and seeking all draw the same pointer.
 */
export interface PointerPlan {
  /** The command the pointer rests on or leaves from, or null before the first one. */
  from: LogEntry | null;
  /** The command it is travelling to, or null while it rests. */
  to: LogEntry | null;
  /** How far the travel has come, from 0 to 1, already eased. */
  progress: number;
  /** Milliseconds since `from` happened, or null before the first command. */
  sinceClick: number | null;
}

/** The longest a move between two controls takes. */
export const TRAVEL_MS = 780;
/** The pointer arrives this long before its command, as a hand does before a click. */
export const SETTLE_MS = 110;
/** A move never takes more than this share of the gap between two commands. */
const GAP_SHARE = 0.7;

/** Slow at both ends, with no jump in speed. */
export function ease(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** The commands a person made. Outcomes arrive by themselves, with no hand on anything. */
export function userCommands(commands: readonly LogEntry[]): LogEntry[] {
  return commands.filter((command) => command.source === 'user');
}

/** `made` must be sorted by time, as a recording is. */
export function pointerAt(made: readonly LogEntry[], t: number, start: number): PointerPlan {
  // The last command at or before `t`, by binary search, since a log can be long.
  let low = 0;
  let high = made.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (made[mid]!.t <= t) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  const from = index >= 0 ? made[index]! : null;
  const next = made[index + 1] ?? null;
  const sinceClick = from === null ? null : t - from.t;
  if (next === null) return { from, to: null, progress: 0, sinceClick };

  const gap = next.t - (from?.t ?? start);
  const travel = Math.min(TRAVEL_MS, Math.max(0, gap * GAP_SHARE));
  const arrival = next.t - Math.min(SETTLE_MS, gap * (1 - GAP_SHARE));
  const left = arrival - travel;
  if (t <= left || travel === 0) return { from, to: null, progress: 0, sinceClick };
  return { from, to: next, progress: ease((t - left) / travel), sinceClick };
}
