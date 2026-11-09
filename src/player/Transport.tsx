import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CameraShot, Caption, Chapter } from '../core/project';
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

/** Sizes in pixels. The recording's line sits under the chapter names, the viewer's below it. */
const INSET = 8;
const LABELS = 26;
const RAIL = 6;
const SEGMENT_GAP = 3;
const LANE = 19;
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
function Fork({
  x,
  width,
  top,
  edits,
  kept,
}: {
  x: number;
  width: number;
  top: number;
  edits: number;
  kept: boolean;
}) {
  const mine = top + LANE;
  // Close to the end there is no room ahead, so the copy runs back under the recording.
  const way = width - x < BEND + 96 ? -1 : 1;
  const bent = x + way * BEND;
  const room = way > 0 ? width - INSET - bent : bent - INSET;
  const shown = Math.min(edits, Math.max(0, Math.floor((room - 84) / EDIT_GAP)));
  const end = bent + way * (12 + shown * EDIT_GAP);
  const reach = x + way * (BEND * 0.5);
  return (
    <g className="reel-fork" data-kept={kept}>
      <path
        pathLength={1}
        d={`M ${x} ${top} C ${reach} ${top}, ${reach} ${mine}, ${bent} ${mine} L ${end} ${mine}`}
      />
      {Array.from({ length: shown }, (_, i) => {
        const at = bent + way * (i + 1) * EDIT_GAP;
        return <line key={at} x1={at} x2={at} y1={mine - 4} y2={mine + 4} />;
      })}
      <circle cx={end} cy={mine} r={4.5} />
      <text x={end + way * 11} y={mine + 4} textAnchor={way > 0 ? 'start' : 'end'}>
        {kept ? 'Set aside' : 'Your copy'}
      </text>
    </g>
  );
}

const NAME_GAP = 2;

/**
 * Where each chapter name goes: centred on its chapter, then moved just far enough to
 * clear its neighbours and the ends of the track. Returns null when they cannot all fit.
 */
export function placeNames(
  parts: readonly { left: number; right: number }[],
  widths: readonly number[],
  track: number,
): ({ left: number } | null)[] | null {
  const at = parts.map((part, i) => (part.left + part.right) / 2 - widths[i]! / 2);
  for (let i = 0; i < at.length; i++) {
    at[i] = Math.max(at[i]!, i === 0 ? 0 : at[i - 1]! + widths[i - 1]! + NAME_GAP);
  }
  for (let i = at.length - 1; i >= 0; i--) {
    const limit = i === at.length - 1 ? track : at[i + 1]!;
    at[i] = Math.min(at[i]!, limit - widths[i]! - (i === at.length - 1 ? 0 : NAME_GAP));
  }
  if (at.length > 0 && at[0]! < 0) return null;
  return at.map((left) => ({ left: Math.round(left) }));
}

export interface TimelineBarProps {
  range: { start: number; end: number };
  t: number;
  chapters: readonly Chapter[];
  /** Times of the recorded commands. Each one gets a dot under the line. */
  steps?: readonly number[];
  onSeek: (t: number) => void;
  disabled: boolean;
  fork: ForkMark | null;
  /** Writes each chapter's name over its part of the line, as a way to jump to it. */
  labels?: boolean;
  /** The authored tracks, drawn as two thin lanes. Only an authoring view passes them. */
  tracks?: { captions: readonly Caption[]; camera: readonly CameraShot[] } | null;
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
 * The story as a line cut into its chapters, over a native range input with the keyboard
 * behaviour of the WAI-ARIA slider pattern. `aria-valuetext` reads time and chapter, since
 * a raw millisecond count means nothing when spoken. The line is drawn in real pixels, so
 * the fork keeps its shape at every width.
 *
 * `step` is 1 because a browser snaps a range value to multiples of its step, and an end
 * time like 3637 ms would be unreachable with a coarser one. The final state must be
 * reachable. Key presses would then move by 1 ms, so they are handled here instead.
 */
export function TimelineBar({
  range,
  t,
  chapters,
  steps = [],
  onSeek,
  disabled,
  fork,
  labels = false,
  tracks = null,
}: TimelineBarProps) {
  const track = useRef<HTMLDivElement>(null);
  const clip = useId();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const names = useRef<(HTMLButtonElement | null)[]>([]);
  /** The width each chapter name wants, measured for one track width and set of names. */
  const [wanted, setWanted] = useState<{ key: string; widths: number[] } | null>(null);
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

  const top = (labels ? LABELS : 4) + 8;
  const height = top + LANE + 10;
  const span = Math.max(1, range.end - range.start);
  const usable = Math.max(0, width - INSET * 2);
  // The slider's thumb stops short of each end by its own radius, and the line matches it.
  const x = (time: number) => INSET + ((Math.min(range.end, Math.max(range.start, time)) - range.start) / span) * usable;
  const timeAt = (px: number) => range.start + (Math.min(usable, Math.max(0, px - INSET)) / Math.max(1, usable)) * span;

  // One part per chapter. Time before the first chapter is a part with no name.
  const inside = chapters.filter((c) => c.t > range.start && c.t < range.end);
  const cuts = [range.start, ...inside.map((c) => c.t), range.end];
  const parts = cuts.slice(0, -1).map((from, i) => {
    const index = chapterIndexAt(chapters, from);
    return {
      from,
      left: x(from) + (i > 0 ? SEGMENT_GAP / 2 : 0),
      right: x(cuts[i + 1]!) - (i < cuts.length - 2 ? SEGMENT_GAP / 2 : 0),
      index,
      chapter: index >= 0 ? chapters[index]! : null,
    };
  });
  const current = chapterIndexAt(chapters, t);

  // Each name is centred over its chapter. A name wider than a short chapter is allowed
  // to reach past it, and its neighbours give way. Only when the names cannot all fit
  // does each one keep to its own chapter and shorten.
  const named = parts.filter((part) => part.chapter !== null);
  const key = `${width}:${named.map((part) => part.chapter!.title).join('\n')}`;
  useLayoutEffect(() => {
    if (!labels || width === 0 || wanted?.key === key) return;
    setWanted({ key, widths: named.map((_, i) => Math.ceil(names.current[i]?.offsetWidth ?? 0)) });
  });
  const placed = wanted?.key === key ? placeNames(named, wanted.widths, width) : null;

  return (
    <div
      className="reel-track"
      ref={track}
      data-labels={labels}
      data-disabled={disabled}
      style={{ height }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse' || disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const y = event.clientY - bounds.top;
        setHover(Math.abs(y - top) <= 12 ? event.clientX - bounds.left : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {labels && width > 0 && (
        <ol className="reel-chapters">
          {named.map(({ chapter, index, left, right }, i) => (
              <li
                key={chapter!.id}
                style={placed === null ? { left } : (placed[i] ?? { left, width: Math.max(0, right - left) })}
              >
                <button
                  ref={(element) => {
                    names.current[i] = element;
                  }}
                  type="button"
                  className="reel-chapter"
                  aria-current={index === current ? 'true' : undefined}
                  aria-disabled={disabled}
                  aria-label={`Chapter ${index + 1}, ${chapter!.title}, at ${formatTime(chapter!.t)}`}
                  title={chapter!.title}
                  onClick={() => {
                    if (!disabled) onSeek(chapter!.t);
                  }}
                >
                  <i>{index + 1}</i>
                  <span data-text={chapter!.title}>{chapter!.title}</span>
                </button>
              </li>
          ))}
        </ol>
      )}
      <svg className="reel-rail" width={width} height={height} aria-hidden="true">
        <clipPath id={clip}>
          <rect x={0} y={0} width={x(t)} height={height} />
        </clipPath>
        {parts.map(({ from, left, right }) => (
          <rect
            key={from}
            className="reel-part"
            x={left}
            y={top - RAIL / 2}
            width={Math.max(0, right - left)}
            height={RAIL}
            rx={RAIL / 2}
          />
        ))}
        <g clipPath={`url(#${clip})`}>
          {parts.map(({ from, left, right }) => (
            <rect
              key={from}
              className="reel-done"
              x={left}
              y={top - RAIL / 2}
              width={Math.max(0, right - left)}
              height={RAIL}
              rx={RAIL / 2}
            />
          ))}
        </g>
        {tracks === null &&
          steps.map((step) => (
            <circle key={step} className="reel-step-tick" data-past={step <= t} cx={x(step)} cy={top + 10} r={1.6} />
          ))}
        {tracks?.captions.map((caption) => (
          <rect
            key={caption.id}
            className="reel-lane-caption"
            x={x(caption.start)}
            y={top + 8}
            width={Math.max(3, x(caption.end) - x(caption.start) - 2)}
            height={4}
            rx={2}
          />
        ))}
        {tracks?.camera.map((shot, i) =>
          shot.target === null ? null : (
            <rect
              key={shot.id}
              className="reel-lane-camera"
              x={x(shot.t)}
              y={top + 16}
              width={Math.max(3, x(tracks.camera[i + 1]?.t ?? range.end) - x(shot.t) - 2)}
              height={4}
              rx={2}
            />
          ),
        )}
        {fork !== null && width > 0 && (
          <Fork x={x(fork.t)} width={width} top={top} edits={fork.edits} kept={fork.kept} />
        )}
      </svg>
      <input
        type="range"
        className="reel-slider"
        style={{ top: top - 16 }}
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
      {hover !== null && width > 0 && (
        <span className="reel-hover" aria-hidden="true" style={{ left: Math.min(width - INSET, Math.max(INSET, hover)), top: top + 12 }}>
          {formatTime(timeAt(hover))}
        </span>
      )}
    </div>
  );
}
