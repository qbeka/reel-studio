import { describe, expect, it } from 'vitest';
import { FULL_VIEW, frameRect, placeCaption, projectRect } from '../../src/core/camera';
import { captionAt, chapterIndexAt, shotAt } from '../../src/core/tracks';

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

describe('placeCaption', () => {
  const height = 560;
  const caption = 70;

  it('uses the bottom with no target', () => {
    expect(placeCaption(null, height, caption)).toBe('bottom');
  });

  it('moves up when the target is at the bottom', () => {
    expect(placeCaption({ x: 0, y: 480, width: 100, height: 60 }, height, caption)).toBe('top');
  });

  it('stays at the bottom when the target is at the top', () => {
    expect(placeCaption({ x: 0, y: 0, width: 100, height: 60 }, height, caption)).toBe('bottom');
  });

  it('chooses the smaller overlap when the target fills the stage', () => {
    expect(placeCaption({ x: 0, y: 40, width: 100, height: 500 }, height, caption)).toBe('top');
    expect(placeCaption({ x: 0, y: 10, width: 100, height: 500 }, height, caption)).toBe('bottom');
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
});
