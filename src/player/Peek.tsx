import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnyAdapter, LayoutName } from '../core/adapter';
import type { Rect } from '../core/camera';
import { type Change, diffStates } from '../core/diff';
import { type Chapter, formatTime } from '../core/project';
import type { Timeline } from '../core/timeline';
import { chapterIndexAt } from '../core/tracks';
import { Mini } from './Mini';
import { boundsOf, changedElements } from './marks';

/** How many changes a peek spells out. The rest are counted. */
const SHOWN = 3;

const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length &&
  a.every((r, i) => r.x === b[i]!.x && r.y === b[i]!.y && r.width === b[i]!.width && r.height === b[i]!.height);

/**
 * One value that differs. In a comparison the earlier value is struck through. In a look
 * ahead neither is wrong, so `plain` leaves both standing and `mark` says which is which.
 */
export function ChangeRow({ change, plain = false }: { change: Change; plain?: boolean }) {
  return (
    <li className="reel-change" data-plain={plain}>
      <span className="reel-change-label">{change.label}</span>
      <span className="reel-change-values">
        {change.before !== null && <s>{change.before}</s>}
        {change.before !== null && change.after !== null && (
          <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
            <path d="M1 4h9M7 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <b>{change.after ?? 'Not shown'}</b>
      </span>
    </li>
  );
}

export interface PeekProps {
  adapter: AnyAdapter;
  timeline: Timeline;
  /** The moment under the mouse. */
  t: number;
  /** The state on the stage, which the moment is compared with. */
  now: unknown;
  chapters: readonly Chapter[];
  /** The plain line for each command that has one, by time. */
  steps: readonly { t: number; text: string }[];
  layout: LayoutName;
  width: number;
  /** The scene on the stage, read to find what the two show differently. */
  stageScene: () => Element | null;
}

/**
 * Any moment of the story, shown without going there. A video player would show a stored
 * thumbnail here. Reel has no pictures to show, so it works out the state at that moment
 * and runs the app on it, small. Because both moments are states, it can also say exactly
 * what differs between this one and the one on the stage, and outline those parts.
 */
export function Peek({ adapter, timeline, t, now, chapters, steps, layout, width, stageScene }: PeekProps) {
  const count = timeline.countAt(t);
  const state = useMemo(() => timeline.stateAfter(count), [timeline, count]);
  // Read from the moment on screen to the moment under the mouse, so the value in bold is
  // always the one the small app is showing.
  const changes = useMemo(() => diffStates(adapter, now, state), [adapter, now, state]);
  const scene = useRef<HTMLFormElement>(null);
  const [marks, setMarks] = useState<readonly Rect[]>([]);

  // Runs after both scenes are in the page. `count` and `now` are what can change them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scenes are read from the page, and these say when they changed.
  useLayoutEffect(() => {
    const other = stageScene();
    const mine = scene.current;
    if (other === null || mine === null) return;
    const found = now === state ? [] : boundsOf(changedElements(other, mine), mine);
    setMarks((before) => (sameRects(before, found) ? before : found));
  }, [count, now, state, layout, stageScene]);

  const chapterIndex = chapterIndexAt(chapters, t);
  let step: string | null = null;
  for (const line of steps) {
    if (line.t > t) break;
    step = line.text;
  }

  return (
    <div className="reel-peek-card">
      <Mini adapter={adapter} state={state} width={width} layout={layout} marks={marks} sceneRef={scene} />
      <div className="reel-peek-meta">
        <b>{formatTime(t)}</b>
        <span>{chapterIndex >= 0 ? chapters[chapterIndex]!.title : 'Before the first chapter'}</span>
        <i>
          {count} of {timeline.length}
        </i>
      </div>
      <p className="reel-peek-step">{step ?? 'Nothing has happened yet'}</p>
      {changes.length === 0 ? (
        <p className="reel-peek-same">The same state as the moment on screen</p>
      ) : (
        <ul className="reel-changes">
          <li className="reel-change-head">
            {changes.length} {changes.length === 1 ? 'value differs' : 'values differ'} from the moment on screen
          </li>
          {changes.slice(0, SHOWN).map((change) => (
            <ChangeRow key={change.id} change={change} plain />
          ))}
          {changes.length > SHOWN && <li className="reel-change-more">and {changes.length - SHOWN} more</li>}
        </ul>
      )}
    </div>
  );
}
