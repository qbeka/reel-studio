import { describe, expect, it } from 'vitest';
import type { FrameHost } from '../../src/core/playback';
import { Playback } from '../../src/core/playback';
import { Timeline } from '../../src/core/timeline';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { entry, frozen, hashState, referenceHashAt } from './helpers';

const scene = frozen(receiptAdapter);

function manualFrames() {
  let queued: ((now: number) => void) | null = null;
  const host: FrameHost = {
    request(callback) {
      queued = callback;
      return 1;
    },
    cancel: () => {
      queued = null;
    },
  };
  return {
    host,
    step(now: number) {
      const run = queued;
      queued = null;
      run?.(now);
    },
    get active() {
      return queued !== null;
    },
  };
}

const log = [
  entry(100, 'addReceipt'),
  entry(200, 'addReceipt'),
  entry(200, 'addReceipt'),
  entry(900, 'addReceipt'),
];

function make(range = { start: 0, end: 1000 }) {
  const frames = manualFrames();
  const timeline = new Timeline(scene, log, { seed: 2, checkpointEvery: 2 });
  return { frames, playback: new Playback(timeline, range, frames.host) };
}

describe('Playback', () => {
  it('applies commands as logical time passes them', () => {
    const { frames, playback } = make();
    playback.play();
    frames.step(0);
    frames.step(150);
    expect(playback.getSnapshot()).toMatchObject({ t: 150, count: 1 });
    frames.step(250);
    expect(playback.getSnapshot()).toMatchObject({ t: 250, count: 3 });
  });

  it('reaches the same state whatever the frame timing', () => {
    const smooth = make();
    smooth.playback.play();
    smooth.frames.step(0);
    for (let now = 16; now < 1100; now += 16) smooth.frames.step(now);

    const choppy = make();
    choppy.playback.play();
    choppy.frames.step(0);
    for (let now = 240; now < 1400; now += 240) choppy.frames.step(now);

    const a = smooth.playback.getSnapshot();
    const b = choppy.playback.getSnapshot();
    expect(a.playing).toBe(false);
    expect(b.playing).toBe(false);
    expect(hashState(scene, a.state)).toBe(hashState(scene, b.state));
    expect(hashState(scene, a.state)).toBe(referenceHashAt(scene, log, 2, log.length));
  });

  it('caps a long gap between frames, so a hidden tab does not jump the story', () => {
    const { frames, playback } = make();
    playback.play();
    frames.step(0);
    frames.step(600_000);
    expect(playback.getSnapshot().t).toBe(250);
    expect(playback.getSnapshot().playing).toBe(true);
  });

  it('stops at the end of the range', () => {
    const { frames, playback } = make({ start: 0, end: 150 });
    playback.play();
    frames.step(0);
    frames.step(200);
    expect(playback.getSnapshot()).toMatchObject({ t: 150, playing: false, count: 1 });
    expect(frames.active).toBe(false);
  });

  it('starts over when played from the end', () => {
    const { frames, playback } = make({ start: 0, end: 150 });
    playback.seek(150);
    playback.play();
    expect(playback.getSnapshot()).toMatchObject({ t: 0, playing: true, count: 0 });
    expect(frames.active).toBe(true);
  });

  it('clamps a seek to the range and keeps playing after it', () => {
    const { frames, playback } = make({ start: 200, end: 800 });
    expect(playback.getSnapshot()).toMatchObject({ t: 200, count: 3 });
    playback.seek(-50);
    expect(playback.getSnapshot().t).toBe(200);
    playback.seek(9999);
    expect(playback.getSnapshot().t).toBe(800);
    playback.seek(300);
    playback.play();
    playback.seek(400);
    expect(playback.getSnapshot()).toMatchObject({ t: 400, playing: true });
    expect(frames.active).toBe(true);
  });

  it('runs the prologue before a trimmed start', () => {
    const { playback } = make({ start: 250, end: 800 });
    expect(playback.getSnapshot().count).toBe(3);
  });

  it('reports a command that cannot run rather than showing a guess', async () => {
    const frames = manualFrames();
    const bad = [entry(10, 'confirmEdit')];
    const timeline = new Timeline(scene, bad, { seed: 2, checkpointEvery: 2 });
    const playback = new Playback(timeline, { start: 0, end: 100 }, frames.host);
    await playback.ready;
    const snapshot = playback.getSnapshot();
    expect(snapshot.playing).toBe(false);
    expect(snapshot.error).toMatch(/confirmEdit/);
  });
});
