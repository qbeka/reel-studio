import type { AnyAdapter, Command } from './adapter';
import type { Chapter } from './project';
import { hashJson } from './sha256';
import { LiveSession, type SessionHost } from './session';
import type { Timeline } from './timeline';

/** Where a viewer's branch left the story. */
export interface BranchBase {
  t: number;
  /** Hash of the authored state at `t`, for telling whether the viewer changed anything. */
  hash: string;
}

export interface Branch<S = any> {
  base: BranchBase;
  session: LiveSession<S>;
}

const stateHash = (adapter: AnyAdapter, state: unknown) => hashJson(adapter.serialize(state));

/**
 * Starts a viewer's own copy of the scene. The state goes through `serialize` and
 * `restore`, so the branch shares nothing with the authored timeline. Its log is separate
 * from the project's commands, and nothing here can write to either.
 */
export function openBranch<S>(
  adapter: AnyAdapter,
  storyState: S,
  t: number,
  host: SessionHost,
  onChange: (state: S) => void,
): Branch<S> {
  const copy = adapter.restore(structuredClone(adapter.serialize(storyState)), adapter.version) as S;
  return {
    base: { t, hash: stateHash(adapter, storyState) },
    session: new LiveSession<S>({
      adapter,
      host,
      state: copy,
      startT: t,
      startSeq: 1,
      onChange: (state) => onChange(state),
    }),
  };
}

export function isUnchanged(adapter: AnyAdapter, branch: Branch): boolean {
  return stateHash(adapter, branch.session.state) === branch.base.hash;
}

/** Edits the viewer made. Delayed outcomes are the scene's replies, so they do not count. */
export function editCount(commands: readonly (Command & { source: string })[]): number {
  return commands.filter((c) => c.source === 'user').length;
}

export interface ReturnOption {
  chapter: Chapter;
  /**
   * True when the viewer's state is byte for byte the authored state at this chapter.
   * Only then does returning lose nothing. There is no partial match and no merge:
   * every other option restores the chapter's authored state and clears the branch.
   */
  matches: boolean;
}

export function returnOptions<S>(
  adapter: AnyAdapter,
  timeline: Timeline<S>,
  chapters: readonly Chapter[],
  branchState: S,
): ReturnOption[] {
  const mine = stateHash(adapter, branchState);
  return chapters.map((chapter) => ({
    chapter,
    matches: stateHash(adapter, timeline.stateAt(chapter.t)) === mine,
  }));
}
