import { describe, expect, it } from 'vitest';
import { FULL_VIEW, clampCamera, direct, frameRect, mixCamera, projectRect } from '../../src/core/camera';
import { SHOT_EASE_MS, SHOT_LEAD_MS, captionAt, chapterIndexAt, shotAt, shotMixAt } from '../../src/core/tracks';

const viewport = { width: 880, height: 560 };

describe('frameRect', () => {
  it('shows the full scene with no target', () => {
    expect(frameRect(null, viewport)).toEqual(FULL_VIEW);
  });

  it('keeps a framed target fully inside the viewport', () => {
    for (const rect of [
      { x: 0, y: 0, width: 200, height: 120 },
      { x: 700, y: 480, width: 170, height: 70 },
      { x: 300, y: 200, width: 280, height: 200 },
      { x: 10, y: 400, width: 500, height: 150 },
    ]) {
      const camera = frameRect(rect, viewport);
      const shown = projectRect(rect, camera);
      expect(shown.x).toBeGreaterThanOrEqual(-0.001);
      expect(shown.y).toBeGreaterThanOrEqual(-0.001);
      expect(shown.x + shown.width).toBeLessThanOrEqual(viewport.width + 0.001);
      expect(shown.y + shown.height).toBeLessThanOrEqual(viewport.height + 0.001);
    }
  });

  it('never shows space beyond the scene edges', () => {
    const camera = frameRect({ x: 860, y: 540, width: 20, height: 20 }, viewport);
    const corner = projectRect({ x: viewport.width, y: viewport.height, width: 0, height: 0 }, camera);
    expect(corner.x).toBeCloseTo(viewport.width);
    expect(corner.y).toBeCloseTo(viewport.height);
  });

  it('never zooms out past the full scene', () => {
    expect(frameRect({ x: 0, y: 0, width: 2000, height: 2000 }, viewport).scale).toBe(1);
  });
});

describe('mixCamera', () => {
  const framed = { scale: 1.3, x: -200, y: -20 };

  it('returns the ends unchanged, so a settled camera is the same object', () => {
    expect(mixCamera(FULL_VIEW, framed, 0)).toBe(FULL_VIEW);
    expect(mixCamera(FULL_VIEW, framed, 1)).toBe(framed);
  });

  it('moves every part together', () => {
    expect(mixCamera(FULL_VIEW, framed, 0.5)).toEqual({ scale: 1.15, x: -100, y: -10 });
  });

  it('leans away from its target when asked for less than nothing', () => {
    const lean = mixCamera(framed, FULL_VIEW, -0.1);
    expect(lean.scale).toBeGreaterThan(framed.scale);
    expect(lean.x).toBeLessThan(framed.x);
  });
});

describe('a directed move', () => {
  it('starts and ends at rest, exactly on its ends', () => {
    expect(direct(0)).toBe(0);
    expect(direct(1)).toBe(1);
    expect(direct(-1)).toBe(0);
    expect(direct(2)).toBe(1);
    expect(Math.abs(direct(0.001))).toBeLessThan(0.001);
    expect(1 - direct(0.999)).toBeLessThan(0.001);
  });

  it('leans back a little before it sets off, and never passes its target', () => {
    let lowest = 0;
    let highest = 0;
    for (let i = 0; i <= 1000; i++) {
      const value = direct(i / 1000);
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
    expect(lowest).toBeLessThan(-0.005);
    expect(lowest).toBeGreaterThan(-0.03);
    expect(highest).toBe(1);
  });

  it('only moves forward once the lean is over, with no jump in speed', () => {
    let last = direct(0.25);
    let lastStep = 0;
    for (let i = 251; i <= 1000; i++) {
      const value = direct(i / 1000);
      const step = value - last;
      expect(step).toBeGreaterThanOrEqual(0);
      if (i > 252) expect(Math.abs(step - lastStep)).toBeLessThan(0.0002);
      last = value;
      lastStep = step;
    }
  });

  it('spends more of its time settling than setting off', () => {
    expect(direct(0.5)).toBeGreaterThan(0.7);
  });
});

describe('clampCamera', () => {
  it('leaves a camera that is on the scene alone, as the same object', () => {
    const camera = { scale: 1.2, x: -40, y: -10 };
    expect(clampCamera(camera, viewport)).toBe(camera);
  });

  it('brings a camera that leaned past the full view back onto the scene', () => {
    expect(clampCamera({ scale: 0.98, x: 6, y: 2 }, viewport)).toEqual({ scale: 1, x: 0, y: 0 });
    const far = clampCamera({ scale: 1.3, x: -900, y: -900 }, viewport);
    const corner = projectRect({ x: viewport.width, y: viewport.height, width: 0, height: 0 }, far);
    expect(corner.x).toBeCloseTo(viewport.width);
    expect(corner.y).toBeCloseTo(viewport.height);
  });
});

describe('track lookup', () => {
  const captions = [
    { id: 'a', start: 0, end: 10, text: 'a', target: null },
    { id: 'b', start: 5, end: 20, text: 'b', target: null },
    { id: 'c', start: 30, end: 40, text: 'c', target: null },
  ];

  it('shows the newest caption and treats the end as exclusive', () => {
    expect(captionAt(captions, 0)?.id).toBe('a');
    expect(captionAt(captions, 7)?.id).toBe('b');
    expect(captionAt(captions, 20)).toBeNull();
    expect(captionAt(captions, 30)?.id).toBe('c');
    expect(captionAt(captions, 40)).toBeNull();
  });

  it('holds the last camera shot', () => {
    const shots = [
      { id: 'a', t: 10, target: 'x' },
      { id: 'b', t: 20, target: null },
    ];
    expect(shotAt(shots, 5)).toBeNull();
    expect(shotAt(shots, 10)?.id).toBe('a');
    expect(shotAt(shots, 99)?.id).toBe('b');
  });

  it('finds the chapter containing a time', () => {
    const chapters = [
      { id: 'a', t: 10, title: 'A' },
      { id: 'b', t: 20, title: 'B' },
    ];
    expect(chapterIndexAt(chapters, 9)).toBe(-1);
    expect(chapterIndexAt(chapters, 10)).toBe(0);
    expect(chapterIndexAt(chapters, 20)).toBe(1);
  });

  it('moves from the shot before, and a seek lands in the middle of the move', () => {
    const shots = [
      { id: 'a', t: 0, target: null },
      { id: 'b', t: 1000, target: 'x' },
    ];
    const start = 1000 - SHOT_LEAD_MS;
    expect(shotMixAt([], 50)).toEqual({ from: null, to: null, progress: 1 });
    expect(shotMixAt(shots, start - 1)).toEqual({ from: null, to: null, progress: 1 });
    expect(shotMixAt(shots, start)).toEqual({ from: null, to: 'x', progress: 0 });
    expect(shotMixAt(shots, start + SHOT_EASE_MS / 2)).toEqual({ from: null, to: 'x', progress: 0.5 });
    expect(shotMixAt(shots, 90_000).progress).toBe(1);
  });

  it('sets off ahead of its shot, so the camera is already moving as the command lands', () => {
    const shots = [
      { id: 'a', t: 0, target: null },
      { id: 'b', t: 1000, target: 'x' },
    ];
    const landing = shotMixAt(shots, 1000);
    expect(landing.to).toBe('x');
    expect(landing.progress).toBeGreaterThan(0);
    expect(landing.progress).toBeLessThan(1);
  });

  it('never starts a move before the shot it leaves', () => {
    const shots = [
      { id: 'a', t: 900, target: 'x' },
      { id: 'b', t: 1000, target: 'y' },
    ];
    expect(shotMixAt(shots, 899).to).toBe('x');
    expect(shotMixAt(shots, 900)).toEqual({ from: 'x', to: 'y', progress: 0 });
  });
});
