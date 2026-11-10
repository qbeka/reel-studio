import type { Size } from './adapter';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraTransform {
  scale: number;
  x: number;
  y: number;
}

export const FULL_VIEW: CameraTransform = { scale: 1, x: 0, y: 0 };

/**
 * Enough to direct the eye. More than this hides the context a viewer needs, and the rest
 * of the directing is done by quieting what is not the subject.
 */
const MAX_ZOOM = 1.22;
const PADDING = 32;

/**
 * The zoom and pan that frame `rect` inside the scene. Both are in scene coordinates.
 * A screen point is `(point - offset) * scale`, with `x` and `y` as negative offsets.
 *
 * Zoom never goes below 1, so the scene always fills the stage. The offset is clamped to
 * the scene edges, so the camera never shows empty space beyond it.
 */
export function frameRect(rect: Rect | null, viewport: Size): CameraTransform {
  if (rect === null) return FULL_VIEW;
  const fit = Math.min(
    viewport.width / (rect.width + PADDING * 2),
    viewport.height / (rect.height + PADDING * 2),
  );
  const scale = Math.min(MAX_ZOOM, Math.max(1, fit));
  const visibleWidth = viewport.width / scale;
  const visibleHeight = viewport.height / scale;
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const left = clamp(centreX - visibleWidth / 2, 0, viewport.width - visibleWidth);
  const top = clamp(centreY - visibleHeight / 2, 0, viewport.height - visibleHeight);
  return { scale, x: -left, y: -top };
}

/** A camera part of the way from `a` to `b`. `p` runs from 0 to 1, and a little below 0 leans away from `b`. */
export function mixCamera(a: CameraTransform, b: CameraTransform, p: number): CameraTransform {
  if (p === 0 || a === b) return p >= 1 ? b : a;
  if (p >= 1) return b;
  return {
    scale: a.scale + (b.scale - a.scale) * p,
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** How far a move leans the wrong way before it sets off, as a share of the whole move. */
const ANTICIPATION = 0.018;
/** The share of a move over which it leans back and recovers. */
const WIND_UP = 0.22;
/** The move proper starts this far in, so the lean reads before it. */
const DELAY = 0.08;

/**
 * The pace of a directed camera move. It leans back a little first, the way an operator
 * takes up the slack before a push, then goes, and spends most of its time settling. It
 * never goes past its target, because a frame that overshoots reads as a mistake. Its speed
 * is continuous and is zero at both ends.
 *
 * `p` runs from 0 to 1. The result dips just below 0 early on and ends at exactly 1.
 */
export function direct(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const x = Math.max(0, (p - DELAY) / (1 - DELAY));
  // Fastest a quarter of the way in, then a long settle.
  const settle = 1 - (1 - x) ** 4 * (1 + 4 * x);
  const lean = p < WIND_UP ? Math.sin((Math.PI * p) / WIND_UP) ** 2 : 0;
  return settle - ANTICIPATION * lean;
}

/**
 * Keeps a camera on the scene. A move that leans back from the full view would otherwise
 * show the space beyond its edges.
 */
export function clampCamera(camera: CameraTransform, viewport: Size): CameraTransform {
  const scale = Math.max(1, camera.scale);
  const x = clamp(camera.x, viewport.width / scale - viewport.width, 0);
  const y = clamp(camera.y, viewport.height / scale - viewport.height, 0);
  if (scale === camera.scale && x === camera.x && y === camera.y) return camera;
  return { scale, x, y };
}

/** Where a scene rectangle lands in the viewport after the camera moves. */
export function projectRect(rect: Rect, camera: CameraTransform): Rect {
  return {
    x: (rect.x + camera.x) * camera.scale,
    y: (rect.y + camera.y) * camera.scale,
    width: rect.width * camera.scale,
    height: rect.height * camera.scale,
  };
}
