import type { AnyAdapter, LogEntry, Payload } from './adapter';
import { type Issue, type ReelProject, validateCommands } from './project';
import { compareEntries } from './timeline';

/**
 * Editing rules.
 *
 * Commands are the source of truth, so an edit to them can make a later command
 * impossible: remove `selectExpense` and the `setSplit` after it has nothing to act on.
 * An edit is therefore a proposal. `proposeEdit` replays the result, and if anything
 * breaks the editor shows the broken commands and the author chooses. Reel never saves a
 * recording that cannot play.
 *
 * Chapters, captions and camera shots cannot affect scene state, so they need no replay.
 */
export interface EditProposal {
  project: ReelProject;
  /** Commands that would become impossible. Empty means the edit is safe. */
  broken: Issue[];
}

export function proposeEdit(adapter: AnyAdapter, project: ReelProject): EditProposal {
  return { project, broken: validateCommands(adapter, project) };
}

/** The repair the editor offers: the same edit, minus every command it broke. */
export function withoutBroken(adapter: AnyAdapter, proposal: EditProposal): EditProposal {
  const seqs = new Set(proposal.broken.map((issue) => issue.seq));
  const commands = proposal.project.commands.filter((c) => !seqs.has(c.seq));
  // Removing them cannot cause a new failure, because `validateCommands` skipped them when
  // it produced `broken`. Checking again keeps that claim honest.
  return proposeEdit(adapter, { ...proposal.project, commands });
}

export function removeCommands(project: ReelProject, seqs: ReadonlySet<number>): ReelProject {
  return { ...project, commands: project.commands.filter((c) => !seqs.has(c.seq)) };
}

export function retimeCommand(project: ReelProject, seq: number, t: number): ReelProject {
  const commands = project.commands
    .map((c) => (c.seq === seq ? { ...c, t } : c))
    .sort(compareEntries);
  return { ...project, commands };
}

export function setCommandPayload(project: ReelProject, seq: number, payload: Payload): ReelProject {
  return {
    ...project,
    commands: project.commands.map((c) => (c.seq === seq ? { ...c, payload } : c)),
  };
}

export function appendCommands(project: ReelProject, entries: readonly LogEntry[]): ReelProject {
  return { ...project, commands: [...project.commands, ...entries].sort(compareEntries) };
}

export function nextSeq(project: ReelProject): number {
  return project.commands.reduce((max, c) => Math.max(max, c.seq), 0) + 1;
}

/** A track id that is unused anywhere in the project. */
export function newTrackId(project: ReelProject, prefix: string): string {
  const used = new Set(
    [...project.chapters, ...project.captions, ...project.camera].map((item) => item.id),
  );
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Undo history. Projects are immutable, so a snapshot costs only what changed. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** A bound on memory. Older steps fall off the far end. */
export const HISTORY_LIMIT = 200;

export function initialHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
