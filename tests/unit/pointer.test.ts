import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import { SETTLE_MS, TRAVEL_MS, ease, pointerAt, userCommands } from '../../src/core/pointer';

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
    expect(pointerAt(made, 0, 0)).toEqual({ from: null, to: null, progress: 0, sinceClick: null });
    expect(pointerAt(made, arrival - TRAVEL_MS, 0).to).toBeNull();
    const half = pointerAt(made, arrival - TRAVEL_MS / 2, 0);
    expect(half.to?.seq).toBe(1);
    expect(half.progress).toBeCloseTo(0.5, 5);
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
    expect(pointerAt(made, 99_000, 0)).toEqual({ from: made[2], to: null, progress: 0, sinceClick: 93_400 });
  });

  it('gives the same answer for the same time, whatever came before', () => {
    const first = pointerAt(made, 4700, 0);
    pointerAt(made, 100, 0);
    pointerAt(made, 5900, 0);
    expect(pointerAt(made, 4700, 0)).toEqual(first);
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
