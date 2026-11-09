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

/** Enough to direct the eye. More than this hides the context a viewer needs. */
const MAX_ZOOM = 1.35;
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

/** A camera part of the way from `a` to `b`. `p` runs from 0 to 1. */
export function mixCamera(a: CameraTransform, b: CameraTransform, p: number): CameraTransform {
  if (p <= 0 || a === b) return p >= 1 ? b : a;
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

/** Where a scene rectangle lands in the viewport after the camera moves. */
export function projectRect(rect: Rect, camera: CameraTransform): Rect {
  return {
    x: (rect.x + camera.x) * camera.scale,
    y: (rect.y + camera.y) * camera.scale,
    width: rect.width * camera.scale,
    height: rect.height * camera.scale,
  };
}

export type CalloutSide = 'left' | 'right' | 'below';

export interface CalloutPlace {
  side: CalloutSide;
  /** Top left corner of the callout, in the same units as the frame. */
  x: number;
  y: number;
  /** Where its pointer leaves the box, measured down from the top of the box. */
  tail: number;
}

const CALLOUT_MARGIN = 10;
const CALLOUT_GAP = 14;

/**
 * Puts a caption beside the thing it is about, never on top of it. It goes on the side of
 * `anchor` that has room, level with `focusY` when that lies within the anchor, so the
 * words stay next to the control in use. With no anchor, or no room on either side, it
 * sits along the bottom of the frame, where subtitles are expected.
 */
export function placeCallout(
  anchor: Rect | null,
  focusY: number | null,
  frame: Size,
  box: Size,
): CalloutPlace {
  const low = {
    side: 'below' as const,
    x: (frame.width - box.width) / 2,
    y: frame.height - box.height - CALLOUT_MARGIN,
    tail: 0,
  };
  if (anchor === null) return low;
  const centre = anchor.x + anchor.width / 2;
  const order: CalloutSide[] = centre < frame.width * 0.45 ? ['right', 'left'] : ['left', 'right'];
  for (const side of order) {
    const x = side === 'left' ? anchor.x - CALLOUT_GAP - box.width : anchor.x + anchor.width + CALLOUT_GAP;
    if (x < CALLOUT_MARGIN || x + box.width > frame.width - CALLOUT_MARGIN) continue;
    const within = focusY !== null && focusY >= anchor.y - 8 && focusY <= anchor.y + anchor.height + 8;
    const level = within ? focusY : anchor.y + Math.min(anchor.height / 2, box.height / 2 + 12);
    const y = clamp(level - box.height / 2, CALLOUT_MARGIN, frame.height - box.height - CALLOUT_MARGIN);
    return { side, x, y, tail: clamp(level - y, 14, box.height - 14) };
  }
  return low;
}
