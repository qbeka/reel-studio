import type { Caption, CameraShot, Chapter } from './project';

/** The caption showing at `t`. If captions overlap, the one that started last wins. */
export function captionAt(captions: readonly Caption[], t: number): Caption | null {
  let found: Caption | null = null;
  for (const caption of captions) {
    if (caption.start > t) break;
    if (t < caption.end) found = caption;
  }
  return found;
}

/** The last shot at or before `t`. */
export function shotAt(shots: readonly CameraShot[], t: number): CameraShot | null {
  let found: CameraShot | null = null;
  for (const shot of shots) {
    if (shot.t > t) break;
    found = shot;
  }
  return found;
}

/** How long the camera takes to ease from one shot to the next, in logical milliseconds. */
export const SHOT_EASE_MS = 900;

/** The framing in force, the one before it, and how far the move between them has come. */
export interface ShotMix {
  from: string | null;
  to: string | null;
  /** From 0 to 1, not yet eased. */
  progress: number;
}

/**
 * The camera at `t` as a move between two shots. It depends only on the track and the
 * time, so a seek into the middle of a move shows the middle of that move.
 */
export function shotMixAt(shots: readonly CameraShot[], t: number): ShotMix {
  let index = -1;
  for (let i = 0; i < shots.length && shots[i]!.t <= t; i++) index = i;
  if (index < 0) return { from: null, to: null, progress: 1 };
  const shot = shots[index]!;
  const before = index > 0 ? shots[index - 1]!.target : null;
  return { from: before, to: shot.target, progress: Math.min(1, (t - shot.t) / SHOT_EASE_MS) };
}

/** Index of the chapter containing `t`, or -1 before the first chapter. */
export function chapterIndexAt(chapters: readonly Chapter[], t: number): number {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.t > t) break;
    index = i;
  }
  return index;
}
