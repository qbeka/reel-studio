import type { LogEntry } from './adapter';

/**
 * Where the drawn pointer is at a moment of the story, and what its button and the keys
 * under it are doing.
 *
 * Reel records commands, not pointer movement or key presses, so there is no recorded path
 * to play back. The pointer is worked out from the log instead: it rests on the control of
 * the last command, and shortly before the next one it travels to that command's control
 * and arrives ahead of it. A command that sets a typed value is drawn as a press on its
 * field and then one key at a time, with the last key landing as the command happens. It
 * all depends only on the log and the time, so playing, scrubbing and seeking draw the same
 * thing.
 */
export interface PointerPlan {
  /** The command the pointer rests on or leaves from, or null before the first one. */
  from: LogEntry | null;
  /** The command it is travelling to or typing, or null while it rests. */
  to: LogEntry | null;
  /** How far the travel has come, from 0 to 1, already eased. */
  progress: number;
  /** Milliseconds since the button last came up on a control, or null. */
  sinceClick: number | null;
  /** How far down the button is, from 0 to 1. */
  press: number;
  /** The value being typed for `to`, or null when nothing is. */
  typing: Typing | null;
}

export interface Typing {
  /** Keys down so far, from 0 to `of`. */
  keys: number;
  of: number;
  /** True between the press on the field and the first key, while the old value is selected. */
  selecting: boolean;
}

/** The longest a move between two controls takes. */
export const TRAVEL_MS = 780;
/** The pointer arrives this long before it presses, as a hand does before a click. */
export const SETTLE_MS = 110;
/** The button goes down this long before its command, and the command happens as it comes up. */
export const PRESS_DOWN_MS = 90;
/** How long the button takes to come back up. */
export const PRESS_UP_MS = 150;
/** The time between two keys of a typed value. */
export const KEY_MS = 105;
/** The old value stays selected for this long between the press and the first key. */
export const SELECT_MS = 190;
/** A move never takes more than this share of the gap between two commands. */
const GAP_SHARE = 0.7;
/** Pressing and typing never take more than this share of the gap. */
const LEAD_SHARE = 0.45;

/** Slow at both ends, with no jump in speed. */
export function ease(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * A reach for a target: it sets off quickly, is fastest a third of the way there, and
 * spends the rest slowing onto the control. Speed is zero at both ends.
 */
export function approach(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return 1 - (1 - x) ** 3 * (1 + 3 * x);
}

/** The commands a person made. Outcomes arrive by themselves, with no hand on anything. */
export function userCommands(commands: readonly LogEntry[]): LogEntry[] {
  return commands.filter((command) => command.source === 'user');
}

const noKeys = () => 0;

/** How long a typed value takes at its own pace, from the press on its field to its last key. */
const typingTime = (keys: number) => (keys <= 0 ? 0 : SELECT_MS + (keys - 1) * KEY_MS);

/** How far down the button is, `since` milliseconds after it came up. Negative is before. */
function pressAt(since: number): number {
  if (since <= -PRESS_DOWN_MS || since >= PRESS_UP_MS) return 0;
  if (since < 0) return 1 - (-since / PRESS_DOWN_MS) ** 2;
  return (1 - since / PRESS_UP_MS) ** 2;
}

/**
 * `made` must be sorted by time, as a recording is. `keysOf` says how many keys a command
 * types, and 0 for one that is a plain press.
 */
export function pointerAt(
  made: readonly LogEntry[],
  t: number,
  start: number,
  keysOf: (entry: LogEntry) => number = noKeys,
): PointerPlan {
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
  // A typed command was pressed before it happened, so nothing is pressed as it lands.
  const landed = from === null ? null : t - from.t;
  const fromTyped = from !== null && keysOf(from) > 0;
  const rest: PointerPlan = {
    from,
    to: null,
    progress: 0,
    sinceClick: fromTyped ? null : landed,
    press: fromTyped || landed === null ? 0 : pressAt(landed),
    typing: null,
  };
  if (next === null) return rest;

  const gap = next.t - (from?.t ?? start);
  const keys = keysOf(next);
  // A short gap leaves less time, and everything in the typing quickens by the same share.
  const lead = Math.min(typingTime(keys), gap * LEAD_SHARE);
  const pace = keys > 0 ? lead / typingTime(keys) : 1;
  /** When the button comes up on the next control. */
  const click = next.t - lead;
  const travel = Math.min(TRAVEL_MS, Math.max(0, (gap - lead) * GAP_SHARE));
  const arrival = click - Math.min(SETTLE_MS, (gap - lead) * (1 - GAP_SHARE));
  const left = arrival - travel;
  if (t <= left || travel === 0) return rest;

  const until = t - click;
  const moving: PointerPlan = {
    from,
    to: next,
    progress: approach((t - left) / travel),
    sinceClick: rest.sinceClick,
    press: Math.max(rest.press, pressAt(until)),
    typing: null,
  };
  if (keys === 0 || until < 0) return moving;

  // On the field: the old value is selected, then each key lands in turn.
  const step = KEY_MS * pace;
  const sinceFirst = until - SELECT_MS * pace;
  const down = sinceFirst < 0 ? 0 : Math.min(keys - 1, 1 + Math.floor(sinceFirst / step));
  return {
    ...moving,
    sinceClick: until,
    typing: { keys: down, of: keys, selecting: sinceFirst < 0 },
  };
}
