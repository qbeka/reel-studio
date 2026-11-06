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

const MAX_ZOOM = 1.8;
const PADDING = 24;

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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
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

export type CaptionPlacement = 'top' | 'bottom';

/**
 * Picks the edge that overlaps the active target least. `captionHeight` is in the same
 * units as the viewport. With no target the caption sits at the bottom, where subtitles
 * are expected. The bottom also wins a tie.
 */
export function placeCaption(
  target: Rect | null,
  viewportHeight: number,
  captionHeight: number,
): CaptionPlacement {
  if (target === null) return 'bottom';
  const top = Math.max(0, target.y);
  const bottom = Math.min(viewportHeight, target.y + target.height);
  const overlapBottom = Math.max(0, bottom - (viewportHeight - captionHeight));
  const overlapTop = Math.max(0, captionHeight - top);
  return overlapTop < overlapBottom ? 'top' : 'bottom';
}
