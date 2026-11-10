import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import {
  KEY_MS,
  PRESS_DOWN_MS,
  PRESS_UP_MS,
  SELECT_MS,
  SETTLE_MS,
  TRAVEL_MS,
  approach,
  ease,
  pointerAt,
  userCommands,
} from '../../src/core/pointer';

const entry = (seq: number, t: number, source: LogEntry['source'] = 'user'): LogEntry => ({
  seq,
  t,
  source,
  type: 'press',
  payload: {},
});

describe('the drawn pointer', () => {
  const log = [entry(1, 2000), entry(2, 5000), entry(3, 5400, 'outcome'), entry(4, 5600)];
  const made = userCommands(log);

  it('follows only what a person did', () => {
    expect(made.map((c) => c.seq)).toEqual([1, 2, 4]);
  });

  it('rests until shortly before a command, then arrives ahead of it', () => {
    const arrival = 2000 - SETTLE_MS;
    expect(pointerAt(made, 0, 0)).toEqual({ from: null, to: null, progress: 0, sinceClick: null, press: 0, typing: null });
    expect(pointerAt(made, arrival - TRAVEL_MS, 0).to).toBeNull();
    const half = pointerAt(made, arrival - TRAVEL_MS / 2, 0);
    expect(half.to?.seq).toBe(1);
    expect(half.progress).toBeCloseTo(approach(0.5), 5);
    expect(pointerAt(made, arrival, 0).progress).toBe(1);
    expect(pointerAt(made, 1999, 0).progress).toBe(1);
  });

  it('is on the control when its command happens, and counts from the click', () => {
    const at = pointerAt(made, 2000, 0);
    expect(at.from?.seq).toBe(1);
    expect(at.to).toBeNull();
    expect(at.sinceClick).toBe(0);
    expect(pointerAt(made, 2300, 0).sinceClick).toBe(300);
  });

  it('fits a short gap, so a move never starts before the last command', () => {
    expect(pointerAt(made, 5000, 0).to).toBeNull();
    const moving = pointerAt(made, 5300, 0);
    expect(moving.from?.seq).toBe(2);
    expect(moving.to?.seq).toBe(4);
    expect(moving.progress).toBeGreaterThan(0);
    expect(moving.progress).toBeLessThan(1);
  });

  it('stays on the last control once the log is over', () => {
    expect(pointerAt(made, 99_000, 0)).toEqual({
      from: made[2],
      to: null,
      progress: 0,
      sinceClick: 93_400,
      press: 0,
      typing: null,
    });
  });

  it('gives the same answer for the same time, whatever came before', () => {
    const first = pointerAt(made, 4700, 0);
    pointerAt(made, 100, 0);
    pointerAt(made, 5900, 0);
    expect(pointerAt(made, 4700, 0)).toEqual(first);
  });

  it('reaches for a control: quick away, slow onto it, at rest at both ends', () => {
    expect(approach(0)).toBe(0);
    expect(approach(1)).toBe(1);
    expect(approach(-2)).toBe(0);
    expect(approach(3)).toBe(1);
    // More than half way there at half time, because the second half is the slowing down.
    expect(approach(0.5)).toBeGreaterThan(0.6);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const value = approach(i / 100);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    expect(approach(0.01)).toBeLessThan(0.002);
    expect(1 - approach(0.99)).toBeLessThan(0.002);
  });

  it('presses before its command and lets go as the command happens', () => {
    expect(pointerAt(made, 2000 - PRESS_DOWN_MS - 1, 0).press).toBe(0);
    const going = pointerAt(made, 2000 - PRESS_DOWN_MS / 2, 0).press;
    expect(going).toBeGreaterThan(0);
    expect(going).toBeLessThan(1);
    // Fully down the instant before, and the command lands as the button starts back up.
    expect(pointerAt(made, 1999, 0).press).toBeGreaterThan(0.99);
    expect(pointerAt(made, 2000, 0).press).toBe(1);
    expect(pointerAt(made, 2000 + PRESS_UP_MS / 2, 0).press).toBeLessThan(0.5);
    expect(pointerAt(made, 2000 + PRESS_UP_MS, 0).press).toBe(0);
  });

  it('eases from rest to rest', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 10);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(-3)).toBe(0);
    expect(ease(4)).toBe(1);
  });
});

describe('a typed value', () => {
  // The command at 5000 types three keys. The others are plain presses.
  const log = [entry(1, 1000), entry(2, 5000), entry(3, 9000)];
  const keysOf = (command: LogEntry) => (command.seq === 2 ? 3 : 0);
  const lead = SELECT_MS + 2 * KEY_MS;
  const click = 5000 - lead;
  const at = (t: number) => pointerAt(log, t, 0, keysOf);

  it('is pressed on its field ahead of the command, with the old value selected first', () => {
    expect(at(click - SETTLE_MS).progress).toBe(1);
    expect(at(click - 1).typing).toBeNull();
    expect(at(click)).toMatchObject({ sinceClick: 0, typing: { keys: 0, of: 3, selecting: true } });
    expect(at(click + SELECT_MS - 1).typing).toEqual({ keys: 0, of: 3, selecting: true });
  });

  it('lands one key at a time, and the last key is the command itself', () => {
    const first = click + SELECT_MS;
    expect(at(first).typing).toEqual({ keys: 1, of: 3, selecting: false });
    expect(at(first + KEY_MS - 1).typing?.keys).toBe(1);
    expect(at(first + KEY_MS).typing?.keys).toBe(2);
    expect(at(4999).typing?.keys).toBe(2);
    // At the command's own time the value is in the state, so nothing is drawn over it.
    const landed = at(5000);
    expect(landed.typing).toBeNull();
    expect(landed.from?.seq).toBe(2);
  });

  it('never counts down, whatever order the moments are asked for in', () => {
    let last = 0;
    for (let t = click; t < 5000; t += 7) {
      const keys = at(t).typing!.keys;
      expect(keys).toBeGreaterThanOrEqual(last);
      last = keys;
    }
    expect(at(click + SELECT_MS + 3)).toEqual(at(click + SELECT_MS + 3));
  });

  it('does not ring as its command lands, because the press came earlier', () => {
    expect(at(5000).sinceClick).toBeNull();
    expect(at(5000).press).toBe(0);
    expect(at(5200).sinceClick).toBeNull();
  });

  it('fits a short gap by typing faster, never by starting before the last command', () => {
    const close = [entry(1, 1000), entry(2, 1300)];
    const typed = (command: LogEntry) => (command.seq === 2 ? 6 : 0);
    expect(pointerAt(close, 1000, 0, typed).to).toBeNull();
    let seen = 0;
    for (let t = 1001; t < 1300; t++) {
      const plan = pointerAt(close, t, 0, typed);
      if (plan.typing !== null) seen = Math.max(seen, plan.typing.keys);
      expect(plan.from?.seq).toBe(1);
    }
    expect(seen).toBe(5);
  });

  it('leaves a plain press exactly as it was', () => {
    expect(pointerAt(log, 3000, 0, keysOf)).toEqual(pointerAt(log, 3000, 0));
  });
});
