import { useLayoutEffect, useRef, useState } from 'react';
import type { Chapter } from '../core/project';
import { formatTime } from '../core/project';
import { chapterIndexAt } from '../core/tracks';

export function sliderText(t: number, chapters: readonly Chapter[]): string {
  const index = chapterIndexAt(chapters, t);
  const chapter = index >= 0 ? chapters[index] : undefined;
  const time = formatTime(t);
  return chapter === undefined
    ? time
    : `${time}, chapter ${index + 1} of ${chapters.length}: ${chapter.title}`;
}

/** The recording's lane and the viewer's lane, in pixels from the top of the track. */
const STORY_Y = 13;
const MINE_Y = 33;
const HEIGHT = 44;
const INSET = 7;
const BEND = 30;
const EDIT_GAP = 9;

export interface ForkMark {
  t: number;
  edits: number;
  /** True while the copy is set aside and can still be brought back. */
  kept: boolean;
}

/**
 * The viewer's own line, leaving the recording at the moment they took over. The recording
 * stays where it is. The status line says the same in words, so this hides from readers.
 */
function Fork({ x, width, edits, kept }: { x: number; width: number; edits: number; kept: boolean }) {
  // Close to the end there is no room ahead, so the copy runs back under the recording.
  const way = width - x < BEND + 40 ? -1 : 1;
  const bent = x + way * BEND;
  const room = way > 0 ? width - INSET - bent : bent - INSET;
  const shown = Math.min(edits, Math.max(0, Math.floor((room - 12) / EDIT_GAP)));
  const end = bent + way * (12 + shown * EDIT_GAP);
  const reach = x + way * (BEND * 0.5);
  return (
    <g className="reel-fork" data-kept={kept}>
      <path
        pathLength={1}
        d={`M ${x} ${STORY_Y} C ${reach} ${STORY_Y}, ${reach} ${MINE_Y}, ${bent} ${MINE_Y} L ${end} ${MINE_Y}`}
      />
      {Array.from({ length: shown }, (_, i) => {
        const at = bent + way * (i + 1) * EDIT_GAP;
        return <line key={at} x1={at} x2={at} y1={MINE_Y - 4} y2={MINE_Y + 4} />;
      })}
      <circle cx={end} cy={MINE_Y} r={4.5} />
    </g>
  );
}

export interface TimelineBarProps {
  range: { start: number; end: number };
  t: number;
  chapters: readonly Chapter[];
  /** Times of the recorded commands. Each one gets a short tick. */
  steps?: readonly number[];
  onSeek: (t: number) => void;
  disabled: boolean;
  fork: ForkMark | null;
}

/** Keyboard steps for the slider, in milliseconds. */
const SLIDER_KEYS: Record<string, number> = {
  ArrowRight: 1000,
  ArrowUp: 1000,
  ArrowLeft: -1000,
  ArrowDown: -1000,
  PageUp: 5000,
  PageDown: -5000,
};

/**
 * A native range input with the keyboard behaviour of the WAI-ARIA slider pattern.
 * `aria-valuetext` reads time and chapter, since a raw millisecond count means nothing
 * when spoken. The hairline under it is drawn in real pixels, so the fork keeps its shape
 * at every width.
 *
 * `step` is 1 because a browser snaps a range value to multiples of its step, and an end
 * time like 3637 ms would be unreachable with a coarser one. The final state must be
 * reachable. Key presses would then move by 1 ms, so they are handled here instead.
 */
export function TimelineBar({ range, t, chapters, steps = [], onSeek, disabled, fork }: TimelineBarProps) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = track.current!;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const span = Math.max(1, range.end - range.start);
  // The slider's thumb stops short of each end by its own radius, and the line matches it.
  const x = (time: number) => INSET + ((time - range.start) / span) * Math.max(0, width - INSET * 2);
  return (
    <div className="reel-track" ref={track}>
      <svg className="reel-hairline" width={width} height={HEIGHT} aria-hidden="true">
        <line className="reel-rest" x1={INSET} x2={width - INSET} y1={STORY_Y} y2={STORY_Y} />
        <line className="reel-done" x1={INSET} x2={x(t)} y1={STORY_Y} y2={STORY_Y} />
        {steps.map((step) => (
          <line key={step} className="reel-step-tick" x1={x(step)} x2={x(step)} y1={STORY_Y - 3} y2={STORY_Y + 3} />
        ))}
        {chapters.map((chapter) => (
          <line
            key={chapter.id}
            className="reel-chapter-tick"
            x1={x(chapter.t)}
            x2={x(chapter.t)}
            y1={STORY_Y - 6}
            y2={STORY_Y + 6}
          />
        ))}
        {fork !== null && width > 0 && (
          <Fork x={x(fork.t)} width={width} edits={fork.edits} kept={fork.kept} />
        )}
      </svg>
      <input
        type="range"
        className="reel-slider"
        aria-label="Story position"
        aria-valuetext={sliderText(t, chapters)}
        min={range.start}
        max={range.end}
        step={1}
        value={Math.round(t)}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value))}
        onKeyDown={(event) => {
          const step = SLIDER_KEYS[event.key];
          if (step === undefined) return;
          event.preventDefault();
          onSeek(t + step);
        }}
      />
    </div>
  );
}
