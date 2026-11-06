import type { AnyAdapter } from './adapter';
import { type ReelProject, playRange } from './project';

export type TranscriptLine =
  | { kind: 'chapter'; t: number; title: string }
  | { kind: 'step'; t: number; text: string };

/**
 * The plain story: chapter headings and the steps the scene considers important. It is
 * built by replaying the log, so every line describes what the scene actually did.
 */
export function buildTranscript(adapter: AnyAdapter, project: ReelProject): TranscriptLine[] {
  const range = playRange(project);
  const lines: TranscriptLine[] = [];
  const chapters = [...project.chapters];
  const flushChapters = (until: number) => {
    while (chapters.length > 0 && chapters[0]!.t <= until) {
      const chapter = chapters.shift()!;
      if (chapter.t >= range.start && chapter.t <= range.end) {
        lines.push({ kind: 'chapter', t: chapter.t, title: chapter.title });
      }
    }
  };

  let state = adapter.init(project.seed);
  for (const entry of project.commands) {
    if (entry.t > range.end) break;
    flushChapters(entry.t);
    const after = adapter.apply(state, entry, { t: entry.t });
    if (entry.t >= range.start) {
      const text = adapter.describe(state, entry, after);
      if (text !== null) lines.push({ kind: 'step', t: entry.t, text });
    }
    state = after;
  }
  flushChapters(range.end);
  return lines;
}

/** Reads a stored transcript. Unexpected entries are dropped. It is display text only. */
export function parseTranscript(input: unknown): TranscriptLine[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((line): TranscriptLine[] => {
    if (typeof line !== 'object' || line === null || !Number.isInteger(line.t)) return [];
    if (line.kind === 'chapter' && typeof line.title === 'string') {
      return [{ kind: 'chapter', t: line.t, title: line.title }];
    }
    if (line.kind === 'step' && typeof line.text === 'string') {
      return [{ kind: 'step', t: line.t, text: line.text }];
    }
    return [];
  });
}
