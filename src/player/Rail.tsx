import { memo, useLayoutEffect, useRef } from 'react';
import { formatTime } from '../core/project';

export interface RailStep {
  t: number;
  text: string;
  chapter: boolean;
}

export interface RailProps {
  steps: readonly RailStep[];
  /** The step on screen, or -1 before the first one. */
  current: number;
  /** Steps before this index happened before the fork. Null outside a branch. */
  forkAt: number | null;
  mine: readonly string[];
  onSeek: (t: number) => void;
}

/**
 * The recording as a list, one line per command. A branch writes the viewer's own commands
 * into the same list at the fork, and the recorded steps after it stay where they are.
 * Memoized because the viewer re-renders on every animation frame while playing.
 */
export const Rail = memo(function Rail({ steps, current, forkAt, mine, onSeek }: RailProps) {
  const list = useRef<HTMLDivElement>(null);
  const inBranch = forkAt !== null;

  // Moves only this list. `scrollIntoView` would also move the page.
  useLayoutEffect(() => {
    const box = list.current!;
    const item = box.querySelector<HTMLElement>('[data-here="true"]');
    if (item === null) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  });

  const row = (step: RailStep, index: number) => (
    <li key={step.t}>
      <button
        type="button"
        className="reel-step"
        aria-current={index === current ? 'step' : undefined}
        aria-disabled={inBranch}
        tabIndex={inBranch ? -1 : undefined}
        data-here={!inBranch && index === current}
        data-chapter={step.chapter}
        data-after={forkAt !== null && index >= forkAt}
        title={step.text}
        onClick={() => {
          if (!inBranch) onSeek(step.t);
        }}
      >
        <time>{formatTime(step.t)}</time>
        <span>{step.text}</span>
      </button>
    </li>
  );

  const fork = forkAt ?? steps.length;
  return (
    <div className="reel-steps" ref={list}>
      <ol>
        {steps.slice(0, fork).map((step, i) => row(step, i))}
        {inBranch && (
          <li className="reel-mine" data-here={true}>
            <p>Your copy</p>
            {mine.length > 0 && (
              <ol>
                {mine.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows.
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}
          </li>
        )}
        {steps.slice(fork).map((step, i) => row(step, fork + i))}
      </ol>
    </div>
  );
});
