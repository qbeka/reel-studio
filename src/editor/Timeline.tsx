import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../core/adapter';
import { type ReelProject, formatTime } from '../core/project';

export type Selection =
  | { kind: 'command'; seq: number }
  | { kind: 'chapter'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'shot'; id: string }
  | null;

/** Commands drawn outside the visible window would only cost time, so they are skipped. */
const OVERSCAN_PX = 200;
const END_PADDING_MS = 1500;
const MIN_ZOOM = 2;
const MAX_ZOOM = 240;

function visibleCommands(commands: readonly LogEntry[], fromT: number, toT: number): LogEntry[] {
  let low = 0;
  let high = commands.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (commands[mid]!.t < fromT) low = mid + 1;
    else high = mid;
  }
  const out: LogEntry[] = [];
  for (let i = low; i < commands.length && commands[i]!.t <= toT; i++) out.push(commands[i]!);
  return out;
}

interface DragState {
  startX: number;
  deltaMs: number;
  selection: NonNullable<Selection>;
}

export interface TimelineProps {
  /** True during recording, when the log must not change underneath the session. */
  locked: boolean;
  project: ReelProject;
  end: number;
  t: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onSeek: (t: number) => void;
  /** Called when a drag ends, with the item's new time. */
  onMove: (selection: NonNullable<Selection>, t: number) => void;
}

export function Timeline({
  locked,
  project,
  end,
  t,
  selection,
  onSelect,
  onSeek,
  onMove,
}: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  /** Pixels per second. Null means fit the whole story to the width. */
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const element = scroller.current!;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);

  const fit = Math.floor((view.width - 8) / ((end + END_PADDING_MS) / 1000));
  const zoom = chosenZoom ?? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  const pxPerMs = zoom / 1000;
  const x = (time: number) => time * pxPerMs;
  const contentWidth = Math.max(view.width, x(end + END_PADDING_MS));

  const commands = useMemo(
    () =>
      visibleCommands(
        project.commands,
        (view.left - OVERSCAN_PX) / pxPerMs,
        (view.left + view.width + OVERSCAN_PX) / pxPerMs,
      ),
    [project.commands, view, pxPerMs],
  );

  const same = (a: Selection, b: Selection) =>
    a !== null &&
    b !== null &&
    a.kind === b.kind &&
    (a.kind === 'command' ? a.seq === (b as typeof a).seq : a.id === (b as typeof a).id);

  const dragProps = (item: NonNullable<Selection>, time: number) => ({
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect(item);
      setDrag({ startX: event.clientX, deltaMs: 0, selection: item });
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (drag === null) return;
      setDrag({ ...drag, deltaMs: Math.round((event.clientX - drag.startX) / pxPerMs) });
    },
    onPointerUp() {
      if (drag !== null && drag.deltaMs !== 0) {
        onMove(drag.selection, Math.max(0, time + drag.deltaMs));
      }
      setDrag(null);
    },
    onPointerCancel() {
      setDrag(null);
    },
    onClick() {
      onSelect(item);
    },
  });

  const offset = (item: NonNullable<Selection>) =>
    drag !== null && same(drag.selection, item) ? x(drag.deltaMs) : 0;

  const seconds: number[] = [];
  const everySeconds = zoom >= 40 ? 1 : zoom >= 16 ? 5 : 15;
  for (let s = 0; s * 1000 <= end + END_PADDING_MS; s += everySeconds) seconds.push(s);

  const trim = project.trim;

  return (
    <section className="ed-timeline" aria-label="Timeline" inert={locked}>
      <div className="ed-lanes-head" aria-hidden="true">
        <span />
        <span>Chapters</span>
        <span>Captions</span>
        <span>Camera</span>
        <span>Commands</span>
      </div>
      <div className="ed-scroller" ref={scroller}>
        <div className="ed-content" style={{ width: contentWidth }}>
          {/* The ruler is a pointer shortcut. The transport slider is the keyboard route. */}
          <div
            className="ed-ruler"
            aria-hidden="true"
            onPointerDown={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onSeek((event.clientX - box.left) / pxPerMs);
            }}
          >
            {seconds.map((s) => (
              <span key={s} style={{ left: x(s * 1000) }}>
                {formatTime(s * 1000)}
              </span>
            ))}
          </div>

          <div className="ed-lane" data-lane="chapters">
            {project.chapters.map((chapter) => {
              const item = { kind: 'chapter', id: chapter.id } as const;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className="ed-chapter"
                  data-selected={same(selection, item)}
                  style={{ left: x(chapter.t) + offset(item) }}
                  {...dragProps(item, chapter.t)}
                >
                  {chapter.title}
                </button>
              );
            })}
          </div>

          <div className="ed-lane" data-lane="captions">
            {project.captions.map((caption) => {
              const item = { kind: 'caption', id: caption.id } as const;
              return (
                <button
                  key={caption.id}
                  type="button"
                  className="ed-caption"
                  data-selected={same(selection, item)}
                  style={{
                    left: x(caption.start) + offset(item),
                    width: Math.max(10, x(caption.end - caption.start)),
                  }}
                  {...dragProps(item, caption.start)}
                >
                  {caption.text}
                </button>
              );
            })}
          </div>

          <div className="ed-lane" data-lane="camera">
            {project.camera.map((shot, i) => {
              const item = { kind: 'shot', id: shot.id } as const;
              const next = project.camera[i + 1]?.t ?? end;
              return (
                <button
                  key={shot.id}
                  type="button"
                  className="ed-shot"
                  data-selected={same(selection, item)}
                  style={{
                    left: x(shot.t) + offset(item),
                    width: Math.max(10, x(next - shot.t) - 2),
                  }}
                  {...dragProps(item, shot.t)}
                >
                  {shot.target ?? 'Full scene'}
                </button>
              );
            })}
          </div>

          <div className="ed-lane" data-lane="commands">
            {commands.map((entry) => {
              const item = { kind: 'command', seq: entry.seq } as const;
              return (
                <button
                  key={entry.seq}
                  type="button"
                  className="ed-command"
                  data-source={entry.source}
                  data-selected={same(selection, item)}
                  aria-label={`${entry.type} at ${formatTime(entry.t)}`}
                  title={entry.type}
                  style={{ left: x(entry.t) + offset(item) }}
                  {...dragProps(item, entry.t)}
                />
              );
            })}
          </div>

          {trim !== null && (
            <>
              <div className="ed-trimmed" style={{ left: 0, width: x(trim.start) }} aria-hidden="true" />
              <div
                className="ed-trimmed"
                style={{ left: x(trim.end), right: 0 }}
                aria-hidden="true"
              />
            </>
          )}
          <div className="ed-playhead" style={{ left: x(t) }} aria-hidden="true" />
        </div>
      </div>
      <label className="ed-zoom">
        Zoom
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          value={zoom}
          onChange={(event) => setChosenZoom(Number(event.target.value))}
        />
      </label>
    </section>
  );
}
