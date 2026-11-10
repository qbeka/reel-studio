import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

export interface ForkMark {
  t: number;
  edits: number;
  /** True while the copy is set aside and can still be brought back. */
  kept: boolean;
  /**
   * How long the copy has been running, and when each thing happened in it, in milliseconds
   * since the fork. With these the copy is drawn on the recording's own time scale.
   */
  elapsed?: number;
  marks?: readonly { at: number; made: boolean }[];
}

/** The copy's line always shows at least this much, so it can be seen the moment it starts. */
const FORK_MIN = 26;
/** Room kept past the end of the copy's line for its name. */
const FORK_NAME = 92;

/**
 * The viewer's own line, leaving the recording at the moment they took over and running
 * beside it. The recording stays where it is. Both lines share one time scale while there
 * is room, so a minute in the copy is as long as a minute of the recording, and the copy's
 * scale tightens once it would run off the end. The status line says the same in words, so
 * this hides from readers.
 */
function Fork({
  x,
  width,
  top,
  perMs,
  fork,
}: {
  x: number;
  width: number;
  top: number;
  /** Pixels per millisecond on the recording's line. */
  perMs: number;
  fork: ForkMark;
}) {
  const { edits, kept, marks = [], elapsed = 0 } = fork;
  const mine = top + LANE;
  // Close to the end there is no room ahead, so the copy runs back under the recording.
  const way = width - x < BEND + FORK_NAME + 40 ? -1 : 1;
  const bent = x + way * BEND;
  const room = Math.max(0, (way > 0 ? width - INSET - bent : bent - INSET) - FORK_NAME);
  const last = Math.max(elapsed, marks.at(-1)?.at ?? 0);
  const scale = Math.min(perMs, last > 0 ? (room - FORK_MIN) / last : perMs);
  const place = (at: number) => bent + way * (FORK_MIN * 0.5 + Math.max(0, at) * Math.max(0, scale));
  const end = bent + way * (FORK_MIN + last * Math.max(0, scale));
  const reach = x + way * (BEND * 0.5);
  return (
    <g className="reel-fork" data-kept={kept}>
      <path
        className="reel-fork-leave"
        pathLength={1}
        d={`M ${x} ${top} C ${reach} ${top}, ${reach} ${mine}, ${bent} ${mine}`}
      />
      <line className="reel-fork-run" x1={bent} x2={end} y1={mine} y2={mine} />
      {marks.map((mark, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: a log only grows, so an index names one entry for good.
          key={i}
          className="reel-fork-mark"
          data-made={mark.made}
          cx={place(mark.at)}
          cy={mine}
          r={mark.made ? 3 : 2}
        />
      ))}
      <circle className="reel-fork-head" cx={end} cy={mine} r={4.5} />
      <text x={end + way * 11} y={mine + 4} textAnchor={way > 0 ? 'start' : 'end'}>
        {kept ? 'Set aside' : 'Your copy'}
        {edits > 0 && <tspan className="reel-fork-count">{`  ${edits} ${edits === 1 ? 'edit' : 'edits'}`}</tspan>}
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
  /**
   * What to show above the line for the moment under a mouse. With it the line becomes a
   * way to look at any moment without going there.
   */
  peek?: (t: number) => ReactNode;
  /** A moment held for comparison, marked on the line. */
  pin?: number | null;
}

/** The widest a peek can be. It is kept inside the track. */
const PEEK_WIDTH = 348;

const NO_STEPS: readonly number[] = [];

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
  steps = NO_STEPS,
  onSeek,
  disabled,
  fork,
  labels = false,
  tracks = null,
  peek,
  pin = null,
}: TimelineBarProps) {
  const track = useRef<HTMLDivElement>(null);
  const clip = useId();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  /** True while a button is down on the line. The stage is then showing the moment itself. */
  const [held, setHeld] = useState(false);
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

  // One dot per command, as a single path of zero length strokes with round ends. A long
  // log has thousands, and as one path they cost nothing when the story moves: the dots
  // already passed are the same path again, cut off at the playhead.
  const dots = useMemo(() => {
    if (usable === 0) return '';
    const from = range.start;
    let d = '';
    let last = Number.NaN;
    for (const step of steps) {
      if (step < from || step > range.end) continue;
      // Commands closer than a third of a pixel share a dot.
      const at = Math.round((INSET + ((step - from) / span) * usable) * 3) / 3;
      if (at === last) continue;
      last = at;
      d += `M${at.toFixed(2)} ${top + 10}h0`;
    }
    return d;
  }, [steps, range.start, range.end, span, usable, top]);

  // Each name is centred over its chapter. A name wider than a short chapter is allowed
  // to reach past it, and its neighbours give way. Only when the names cannot all fit
  // does each one keep to its own chapter and shorten.
  const named = parts.filter((part) => part.chapter !== null);
  const key = `${width}:${named.map((part) => part.chapter!.title).join('\n')}`;
  useLayoutEffect(() => {
    if (!labels || width === 0 || wanted?.key === key) return;
    setWanted({ key, widths: named.map((_, i) => Math.ceil(names.current[i]?.offsetWidth ?? 0)) });
  });
  // Undefined until the names have been measured at this width, and null when they cannot fit.
  const placed = wanted?.key === key ? placeNames(named, wanted.widths, width) : undefined;

  return (
    <div
      className="reel-track"
      ref={track}
      data-labels={labels}
      data-disabled={disabled}
      style={{ height }}
      data-peeking={peek !== undefined && hover !== null && !held}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse' || disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const y = event.clientY - bounds.top;
        // The line and the row of command dots under it, and nothing of the chapter names.
        setHover(y >= top - 12 && y <= top + 18 ? event.clientX - bounds.left : null);
      }}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => {
        setHover(null);
        setHeld(false);
      }}
    >
      {labels && width > 0 && (
        <ol className="reel-chapters">
          {named.map(({ chapter, index, left, right }, i) => (
              <li
                key={chapter!.id}
                style={placed === undefined ? { left } : (placed?.[i] ?? { left, width: Math.max(0, right - left) })}
              >
                <button
                  ref={(element) => {
                    names.current[i] = element;
                  }}
                  type="button"
                  className="reel-chapter"
                  aria-current={index === current ? 'true' : undefined}
                  aria-disabled={disabled}
                  title={`${chapter!.title}, at ${formatTime(chapter!.t)}`}
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
        {tracks === null && dots !== '' && (
          <>
            <path className="reel-step-tick" d={dots} />
            <path className="reel-step-tick" data-past="true" d={dots} clipPath={`url(#${clip})`} />
          </>
        )}
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
          <Fork x={x(fork.t)} width={width} top={top} perMs={usable / span} fork={fork} />
        )}
        {pin !== null && width > 0 && (
          <g className="reel-pin" transform={`translate(${x(pin)} ${top})`}>
            <line y1={-11} y2={11} />
            <rect x={-7} y={-25} width={14} height={14} rx={4} />
            <text y={-14.500} textAnchor="middle">
              A
            </text>
          </g>
        )}
        {peek !== undefined && hover !== null && !held && width > 0 && (
          <line
            className="reel-peek-line"
            x1={Math.min(width - INSET, Math.max(INSET, hover))}
            x2={Math.min(width - INSET, Math.max(INSET, hover))}
            y1={top - 9}
            y2={top + 9}
          />
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
      {hover !== null && width > 0 && peek === undefined && (
        <span className="reel-hover" aria-hidden="true" style={{ left: Math.min(width - INSET, Math.max(INSET, hover)), top: top + 12 }}>
          {formatTime(timeAt(hover))}
        </span>
      )}
      {hover !== null && width > 0 && peek !== undefined && !held && (
        <div
          className="reel-peek"
          aria-hidden="true"
          style={{
            width: Math.min(PEEK_WIDTH, width),
            left: Math.round(Math.min(Math.max(0, width - PEEK_WIDTH), Math.max(0, hover - PEEK_WIDTH / 2))),
            bottom: height - top + 16,
            // Where the moment is under the card, for the stem that joins them.
            ['--at' as string]: `${Math.round(hover - Math.min(Math.max(0, width - PEEK_WIDTH), Math.max(0, hover - PEEK_WIDTH / 2)))}px`,
          }}
        >
          {peek(Math.round(timeAt(hover)))}
        </div>
      )}
    </div>
  );
}
