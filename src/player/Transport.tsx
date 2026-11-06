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

/**
 * The hairline that leaves the timeline at the moment of control. It gains a tick for
 * each edit. This is decoration for a state the status text already states in words.
 */
function Fork({ at, edits }: { at: number; edits: number }) {
  const width = 100;
  const stem = 7;
  const tickGap = 2.4;
  const shown = Math.min(edits, 16);
  const end = Math.min(width, at + stem + shown * tickGap + 6);
  return (
    <svg className="reel-fork" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={`M ${at} 2 C ${at + stem * 0.4} 2, ${at + stem * 0.5} 14, ${at + stem} 14 L ${end} 14`}
        vectorEffect="non-scaling-stroke"
      />
      {Array.from({ length: shown }, (_, i) => {
        const x = Math.min(width - 1, at + stem + (i + 1) * tickGap);
        return <line key={x} x1={x} x2={x} y1={10} y2={18} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

export interface TimelineBarProps {
  range: { start: number; end: number };
  t: number;
  chapters: readonly Chapter[];
  onSeek: (t: number) => void;
  disabled: boolean;
  fork: { t: number; edits: number } | null;
}

/**
 * A native range input carries the keyboard behaviour from the WAI-ARIA slider pattern:
 * arrows, Home, End, Page Up and Page Down. `aria-valuetext` reads time and chapter, since
 * a raw millisecond count means nothing when spoken.
 */
export function TimelineBar({ range, t, chapters, onSeek, disabled, fork }: TimelineBarProps) {
  const span = Math.max(1, range.end - range.start);
  const percent = (time: number) => ((time - range.start) / span) * 100;
  return (
    <div className="reel-timeline">
      <div className="reel-track">
        <div className="reel-rule" aria-hidden="true">
          <div className="reel-rule-done" style={{ width: `${percent(t)}%` }} />
        </div>
        {chapters.map((chapter) => (
          <span
            key={chapter.id}
            className="reel-tick"
            aria-hidden="true"
            title={chapter.title}
            style={{ left: `${percent(chapter.t)}%` }}
          />
        ))}
        <input
          type="range"
          className="reel-slider"
          aria-label="Story position"
          aria-valuetext={sliderText(t, chapters)}
          min={range.start}
          max={range.end}
          step={100}
          value={t}
          disabled={disabled}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      {fork !== null && <Fork at={percent(fork.t)} edits={fork.edits} />}
    </div>
  );
}
