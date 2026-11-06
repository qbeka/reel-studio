import { describe, expect, it, vi } from 'vitest';
import type { SessionHost } from '../../src/core/session';
import { LiveSession } from '../../src/core/session';
import { Timeline } from '../../src/core/timeline';
import { SAVE_DELAY_MS, receiptAdapter } from '../../src/scenes/receipt/adapter';
import { frozen, hashState } from './helpers';

const scene = frozen(receiptAdapter);

function fakeHost() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const host: SessionHost = {
    now: () => now,
    setTimer(run, delayMs) {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  return {
    host,
    pending: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    },
  };
}

function session(host: SessionHost, onChange = () => {}) {
  return new LiveSession({
    adapter: scene,
    host,
    state: scene.init(1),
    startT: 0,
    startSeq: 1,
    onChange,
  });
}

describe('LiveSession', () => {
  it('stamps commands with logical time from the injected clock', () => {
    const clock = fakeHost();
    const live = session(clock.host);
    clock.advance(1250);
    live.send('selectExpense', { id: 'e1' });
    expect(live.log[0]).toMatchObject({ seq: 1, t: 1250, source: 'user' });
  });

  it('refuses an unknown command, a bad payload and an impossible command, and logs none', () => {
    const live = session(fakeHost().host);
    expect(live.send('launchRocket')).toMatchObject({ ok: false });
    expect(live.send('selectExpense', { id: 3 })).toMatchObject({ ok: false });
    expect(live.send('confirmEdit')).toMatchObject({ ok: false });
    expect(live.log).toHaveLength(0);
  });

  it('records a delayed outcome as an ordinary log entry', () => {
    const clock = fakeHost();
    const live = session(clock.host);
    live.send('selectExpense', { id: 'e1' });
    live.send('confirmEdit');
    expect(live.state.pendingSave).not.toBeNull();
    clock.advance(SAVE_DELAY_MS);
    expect(live.state.pendingSave).toBeNull();
    expect(live.log.at(-1)).toMatchObject({ type: 'saveResult', source: 'outcome', t: SAVE_DELAY_MS });
  });

  it('drops scheduled outcomes on close', () => {
    const clock = fakeHost();
    const live = session(clock.host);
    live.send('selectExpense', { id: 'e1' });
    live.send('confirmEdit');
    live.close();
    expect(clock.pending()).toBe(0);
    clock.advance(10_000);
    expect(live.log.map((e) => e.type)).toEqual(['selectExpense', 'confirmEdit']);
  });

  it('produces a log that replays to the same state without running any effect', () => {
    const clock = fakeHost();
    const live = session(clock.host);
    live.send('selectExpense', { id: 'e2' });
    live.send('setSplitMode', { mode: 'percent' });
    live.send('setSplit', { member: 'mina', value: 5000 });
    live.send('setSplit', { member: 'theo', value: 2500 });
    live.send('setSplit', { member: 'ana', value: 2500 });
    live.send('confirmEdit');
    clock.advance(SAVE_DELAY_MS);

    const effects = vi.fn(scene.effects);
    const counted = { ...scene, effects };
    const timeline = new Timeline(counted, live.log, { seed: 1, checkpointEvery: 4 });
    const replayed = timeline.stateAfter(live.log.length);
    expect(hashState(scene, replayed)).toBe(hashState(scene, live.state));
    expect(effects).not.toHaveBeenCalled();
  });
});
