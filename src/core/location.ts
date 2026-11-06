import type { Chapter } from './project';

export type LinkedMoment = { kind: 'time'; t: number } | { kind: 'chapter'; id: string } | null;

/**
 * Reads a shared link. Only `#t=<ms>` or `#chapter=<id>` is accepted, and the time must
 * lie in range and the chapter must exist. Anything else is ignored. A link can select a
 * moment in the authored story and cannot carry viewer edits or arbitrary state.
 */
export function parseMoment(
  hash: string,
  chapters: readonly Chapter[],
  range: { start: number; end: number },
): LinkedMoment {
  const time = /^#t=(\d{1,9})$/.exec(hash);
  if (time !== null) {
    const t = Number(time[1]);
    return t >= range.start && t <= range.end ? { kind: 'time', t } : null;
  }
  const chapter = /^#chapter=([a-z0-9-]{1,64})$/.exec(hash);
  if (chapter !== null) {
    const id = chapter[1]!;
    return chapters.some((c) => c.id === id) ? { kind: 'chapter', id } : null;
  }
  return null;
}

export function momentHash(t: number): string {
  return `#t=${Math.round(t)}`;
}
