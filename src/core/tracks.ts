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

/** Index of the chapter containing `t`, or -1 before the first chapter. */
export function chapterIndexAt(chapters: readonly Chapter[], t: number): number {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.t > t) break;
    index = i;
  }
  return index;
}
