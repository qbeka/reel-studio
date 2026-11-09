import { describe, expect, it } from 'vitest';
import { FULL_VIEW, frameRect, mixCamera, placeCallout, projectRect } from '../../src/core/camera';
import { SHOT_EASE_MS, captionAt, chapterIndexAt, shotAt, shotMixAt } from '../../src/core/tracks';

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

describe('placeCallout', () => {
  const frame = { width: 1000, height: 460 };
  const box = { width: 260, height: 70 };

  it('sits along the bottom with no anchor', () => {
    const place = placeCallout(null, null, frame, box);
    expect(place.side).toBe('below');
    expect(place.x).toBe(370);
    expect(place.y + box.height).toBeLessThan(frame.height);
  });

  it('goes to the side of the anchor that has room and never covers it', () => {
    const right = { x: 560, y: 60, width: 420, height: 300 };
    const placed = placeCallout(right, null, frame, box);
    expect(placed.side).toBe('left');
    expect(placed.x + box.width).toBeLessThanOrEqual(right.x);

    const left = { x: 0, y: 0, width: 228, height: 460 };
    expect(placeCallout(left, null, frame, box).side).toBe('right');
    expect(placeCallout(left, null, frame, box).x).toBeGreaterThanOrEqual(left.x + left.width);
  });

  it('stays level with the control in use, and inside the frame', () => {
    const anchor = { x: 560, y: 60, width: 420, height: 300 };
    const level = placeCallout(anchor, 200, frame, box);
    expect(level.y + level.tail).toBe(200);
    const low = placeCallout(anchor, 355, { ...frame, height: 380 }, box);
    expect(low.y + box.height).toBeLessThanOrEqual(370);
    expect(low.tail).toBeLessThanOrEqual(box.height - 14);
  });

  it('falls back to the bottom when neither side has room', () => {
    const wide = { x: 100, y: 40, width: 800, height: 300 };
    expect(placeCallout(wide, 100, frame, box).side).toBe('below');
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

  it('eases from the shot before, and a seek lands in the middle of the move', () => {
    const shots = [
      { id: 'a', t: 0, target: null },
      { id: 'b', t: 1000, target: 'x' },
    ];
    expect(shotMixAt([], 50)).toEqual({ from: null, to: null, progress: 1 });
    expect(shotMixAt(shots, 999)).toEqual({ from: null, to: null, progress: 1 });
    expect(shotMixAt(shots, 1000)).toEqual({ from: null, to: 'x', progress: 0 });
    expect(shotMixAt(shots, 1000 + SHOT_EASE_MS / 2)).toEqual({ from: null, to: 'x', progress: 0.5 });
    expect(shotMixAt(shots, 90_000).progress).toBe(1);
  });
});
