import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnyAdapter, LayoutName, Payload } from '../core/adapter';
import { type CameraTransform, FULL_VIEW, type Rect, clampCamera, direct, frameRect, mixCamera } from '../core/camera';
import type { Caption } from '../core/project';
import type { ShotMix } from '../core/tracks';
import { boundsOf, changedElements } from './marks';

/** Below this stage width a scene uses its narrow coordinate system. */
const NARROW_BELOW = 560;

/** Below this width a filled wide scene scales down, so its two columns keep their shape. */
const MIN_WIDE_WIDTH = 720;

/** Below this width a filled narrow scene scales down too, so a small phone shows all of each row. */
const MIN_NARROW_WIDTH = 344;

/** How long the ring of a click takes to spread and fade, in logical milliseconds. */
const RIPPLE_MS = 460;
/** Room left around the subject of a close shot, which stays clear while the rest is veiled. */
const SUBJECT_ROOM = 10;

/** Room kept around the pointer when a narrow stage scrolls to follow it. */
const FOLLOW_ABOVE = 72;
const FOLLOW_BELOW = 96;

const SHOT_NONE: ShotMix = { from: null, to: null, progress: 1 };

/**
 * Layout bounds of every named target and control, in scene coordinates. Offsets ignore
 * CSS transforms, so bounds do not change while the camera moves or the stage rescales.
 */
export function offsetRect(element: HTMLElement, root: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node !== null && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

function measureTargets(root: HTMLElement): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-reel-target], [data-reel-point]')) {
    const rect = offsetRect(element, root);
    const { reelTarget, reelPoint } = element.dataset;
    if (reelTarget !== undefined) bounds.set(reelTarget, rect);
    if (reelPoint !== undefined) bounds.set(reelPoint, rect);
  }
  return bounds;
}

const sameBounds = (a: Map<string, Rect>, b: Map<string, Rect>) => {
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    const other = b.get(id);
    if (
      other === undefined ||
      other.x !== rect.x ||
      other.y !== rect.y ||
      other.width !== rect.width ||
      other.height !== rect.height
    ) {
      return false;
    }
  }
  return true;
};

/** Rendering the scene is the expensive part, so it only runs when its state changes. */
const SceneView = memo(function SceneView({
  adapter,
  state,
  send,
  interactive,
  layout,
}: {
  adapter: AnyAdapter;
  state: unknown;
  send: (type: string, payload?: Payload) => void;
  interactive: boolean;
  layout: LayoutName;
}) {
  const { Render } = adapter;
  return <Render state={state} send={send} interactive={interactive} layout={layout} />;
});

const ignoreSend = () => {};

/** The drawn pointer, as named places in the scene. See core/pointer.ts for how it is planned. */
export interface StagePointer {
  /** The control it rests on or leaves, or null to rest in the open. */
  from: string | null;
  /** The control it is travelling to, or null. */
  to: string | null;
  /** From 0 to 1, already eased. */
  progress: number;
  /** Logical milliseconds since its button last came up, or null. */
  sinceClick: number | null;
  /** How far down its button is, from 0 to 1. */
  press: number;
  /** The value being typed into the control at `to`, or null. */
  typing: { text: string; keys: number; selecting: boolean } | null;
  /** The short word it carries, saying who is moving it. */
  label: string;
}

/** The field being typed into: where its text sits and how that text is set. */
interface TypedField {
  point: string;
  host: Rect;
  hostRadius: string;
  box: Rect;
  old: string;
  style: CSSProperties;
}

/** The first colour behind an element that is not see-through. */
function backgroundBehind(element: HTMLElement, root: HTMLElement): string {
  for (let node: HTMLElement | null = element; node !== null && node !== root.parentElement; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour !== '' && colour !== 'transparent' && !/,\s*0\)$/.test(colour)) return colour;
  }
  return '#fff';
}

function readField(root: HTMLElement, point: string): TypedField | null {
  const host = root.querySelector<HTMLElement>(`[data-reel-point="${CSS.escape(point)}"]`);
  if (host === null) return null;
  const input = host.matches('input, textarea') ? host : host.querySelector<HTMLElement>('input, textarea');
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return null;
  const set = getComputedStyle(input);
  return {
    point,
    host: offsetRect(host, root),
    hostRadius: getComputedStyle(host).borderRadius,
    box: offsetRect(input, root),
    old: input.value,
    style: {
      font: set.font,
      fontVariantNumeric: set.fontVariantNumeric,
      letterSpacing: set.letterSpacing,
      color: set.color,
      padding: set.padding,
      justifyContent: set.textAlign === 'right' || set.textAlign === 'end' ? 'flex-end' : 'flex-start',
      background: backgroundBehind(input, root),
    },
  };
}

export interface StageProps {
  adapter: AnyAdapter;
  state: unknown;
  interactive: boolean;
  send?: (type: string, payload?: Payload) => void;
  /** The camera as a move between two shots. Leave out for the whole scene. */
  shot?: ShotMix;
  /** How much the camera follows its shots: 0 shows the whole scene, 1 the shot. */
  follow?: number;
  /** Set under the scene by a stage that is not filling a box. A filled stage leaves it to its host. */
  caption?: Caption | null;
  /** The drawn pointer, or null for none. It is never a recording of a real one. */
  pointer?: StagePointer | null;
  /** Puts a stable, known layout on the stage for tests and screenshots. */
  label: string;
  onCommit?: () => void;
  /** Fills the parent box instead of keeping the scene's aspect ratio. */
  fill?: boolean;
  /** Told which coordinate system the scene is using, whenever that changes. */
  onLayout?: (layout: LayoutName) => void;
  /**
   * Another state of the same scene. Wherever the scene on the stage shows something this
   * one would not, that part is outlined.
   */
  against?: unknown;
}

const NO_MARKS: readonly Rect[] = [];

const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length &&
  a.every((r, i) => r.x === b[i]!.x && r.y === b[i]!.y && r.width === b[i]!.width && r.height === b[i]!.height);

export function Stage({
  adapter,
  state,
  interactive,
  send = ignoreSend,
  shot = SHOT_NONE,
  follow = 1,
  caption = null,
  pointer = null,
  label,
  onCommit,
  fill = false,
  onLayout,
  against,
}: StageProps) {
  const twinRef = useRef<HTMLFormElement>(null);
  const [marks, setMarks] = useState<readonly Rect[]>(NO_MARKS);
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<Map<string, Rect>>(() => new Map());
  const [field, setField] = useState<TypedField | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current!;
    // A hidden stage measures zero. It keeps its last size for when it comes back.
    const measure = () => {
      if (frame.clientWidth > 0) setBox({ width: frame.clientWidth, height: frame.clientHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    measure();
    return () => observer.disconnect();
  }, []);

  const { width, height } = box;
  const layout: LayoutName = width > 0 && width < NARROW_BELOW ? 'narrow' : 'wide';
  const authored = adapter.layouts[layout];
  const scrolls = fill && layout === 'narrow';
  let fit = width > 0 ? width / authored.width : 1;
  let sceneWidth = authored.width;
  let sceneHeight = authored.height;
  if (fill && width > 0 && height > 0) {
    if (layout === 'wide') {
      // Only ever scales down, so type stays at its real size when there is room.
      const shortest = adapter.compactHeight ?? authored.height;
      fit = Math.min(1, height / shortest, width / MIN_WIDE_WIDTH);
      sceneWidth = width / fit;
      sceneHeight = height / fit;
    } else {
      // A narrow scene keeps its real size where it can, and scrolls inside the stage.
      fit = Math.min(1, width / MIN_NARROW_WIDTH);
      sceneWidth = width / fit;
      sceneHeight = Math.max(height, authored.height) / fit;
    }
  }

  useEffect(() => onLayout?.(layout), [onLayout, layout]);

  // Runs after React has committed this state to the DOM, before the browser paints.
  useLayoutEffect(() => {
    onCommit?.();
    const measured = measureTargets(sceneRef.current!);
    setBounds((previous) => (sameBounds(previous, measured) ? previous : measured));
    // The other state is drawn out of sight by the same code, and the two are read side by side.
    const twin = twinRef.current;
    const found = twin === null ? NO_MARKS : boundsOf(changedElements(twin, sceneRef.current!), sceneRef.current!);
    setMarks((previous) => (sameRects(previous, found) ? previous : found));
  });

  // The field under the keys is read once as typing starts, so the letters drawn over it
  // sit and look exactly like its own.
  const typedPoint = pointer?.typing != null ? pointer.to : null;
  useLayoutEffect(() => {
    if (typedPoint === null) {
      if (field !== null) setField(null);
      return;
    }
    if (field?.point !== typedPoint) setField(readField(sceneRef.current!, typedPoint));
  }, [typedPoint, field]);

  // A scene that scrolls is followed by scrolling, so its camera stays on the whole scene.
  const [shotFrom, shotTo] = useMemo(() => {
    if (scrolls) return [FULL_VIEW, FULL_VIEW];
    const size = { width: sceneWidth, height: sceneHeight };
    const frame = (target: string | null) =>
      target === null ? FULL_VIEW : frameRect(bounds.get(target) ?? null, size);
    return [frame(shot.from), frame(shot.to)];
  }, [scrolls, sceneWidth, sceneHeight, bounds, shot.from, shot.to]);
  const camera: CameraTransform = useMemo(() => {
    const paced = mixCamera(shotFrom, shotTo, direct(shot.progress));
    const kept = paced === shotFrom || paced === shotTo ? paced : clampCamera(paced, { width: sceneWidth, height: sceneHeight });
    return mixCamera(FULL_VIEW, kept, follow);
  }, [shotFrom, shotTo, shot.progress, follow, sceneWidth, sceneHeight]);
  const scale = fit * camera.scale;
  const framed = camera.scale !== 1 || camera.x !== 0 || camera.y !== 0;

  // A close shot has a subject. The rest of the app stays where it is and goes quiet, so
  // the eye is on the part in use. A viewer in control gets the whole app back.
  const arrived = Math.min(1, Math.max(0, direct(shot.progress)));
  const veils: { id: string; rect: Rect; strength: number }[] = [];
  if (!scrolls && !interactive && follow > 0) {
    const add = (id: string | null, strength: number) => {
      const rect = id === null ? undefined : bounds.get(id);
      if (rect !== undefined && strength > 0.01) veils.push({ id: id!, rect, strength });
    };
    if (shot.from !== shot.to) add(shot.from, follow * (1 - arrived));
    add(shot.to, follow * (shot.from === shot.to ? 1 : arrived));
  }

  // The pointer, in scene coordinates.
  const point = useMemo(() => {
    if (pointer === null || width === 0) return null;
    // Low and to the right of the middle, so the arrow covers as little of a label as it can.
    const spot = (id: string | null) => {
      const rect = id === null ? undefined : bounds.get(id);
      if (rect === undefined) return null;
      const inset = rect.width > 140 ? rect.width / 2 : Math.min(14, rect.width * 0.2);
      return { x: rect.x + rect.width - inset, y: rect.y + rect.height * 0.68 };
    };
    const from = spot(pointer.from) ?? { x: sceneWidth * 0.52, y: Math.min(sceneHeight, height / fit) * 0.6 };
    const to = spot(pointer.to);
    if (to === null) return from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    // A slight bow to one side, the way a hand moves, which is flat at both ends.
    const bow = Math.sin(Math.PI * pointer.progress) ** 2 * Math.min(22, distance * 0.08);
    return {
      x: from.x + dx * pointer.progress + (-dy / distance) * bow,
      y: from.y + dy * pointer.progress + (dx / distance) * bow,
    };
  }, [pointer, bounds, sceneWidth, sceneHeight, width, height, fit]);

  const toFrame = (view: CameraTransform, x: number, y: number) => ({
    x: (x + view.x) * fit * view.scale,
    y: (y + view.y) * fit * view.scale,
  });
  let cursor = point === null ? null : toFrame(camera, point.x, point.y);
  if (cursor !== null && !scrolls) {
    cursor = {
      x: Math.min(width - 6, Math.max(6, cursor.x)),
      y: Math.min(height - 6, Math.max(6, cursor.y)),
    };
  }

  // A narrow stage is too short for the whole scene, so it scrolls to keep the pointer in
  // view. It follows the story only, and leaves the scroll alone once the viewer has it.
  const followY = scrolls && !interactive && cursor !== null ? Math.round(cursor.y) : null;
  useEffect(() => {
    if (followY === null) return;
    const frame = frameRef.current!;
    const top = frame.scrollTop;
    let next = top;
    if (followY < top + FOLLOW_ABOVE) next = followY - FOLLOW_ABOVE;
    else if (followY > top + frame.clientHeight - FOLLOW_BELOW) next = followY - frame.clientHeight + FOLLOW_BELOW;
    if (next !== top) frame.scrollTo({ top: Math.max(0, next), behavior: 'auto' });
  }, [followY]);

  // Where the camera has left part of the scene outside the frame, that edge fades out,
  // so a close view reads as a close view and not as a page cut short.
  const beyond = (hidden: number) => Math.min(1, Math.max(0, (hidden * scale) / 28));
  const fades = scrolls
    ? null
    : {
        '--fade-left': beyond(-camera.x),
        '--fade-top': beyond(-camera.y),
        '--fade-right': beyond(sceneWidth + camera.x - sceneWidth / camera.scale),
        '--fade-bottom': beyond(sceneHeight + camera.y - sceneHeight / camera.scale),
      };

  const since = pointer?.sinceClick ?? null;
  const ripple = since !== null && since >= 0 && since < RIPPLE_MS ? since / RIPPLE_MS : null;
  const press = pointer?.press ?? 0;
  // The control under the button while it is down, which answers as a pressed control does.
  const underId = pointer === null || press === 0 ? null : pointer.to !== null && pointer.progress >= 1 ? pointer.to : pointer.to === null ? pointer.from : null;
  const under = underId === null ? undefined : bounds.get(underId);
  const typing = pointer?.typing ?? null;
  const typed = typing !== null && field !== null && field.point === pointer?.to ? field : null;

  return (
    <figure className="reel-stage" aria-label={label} data-layout={layout} data-fill={fill}>
      <div
        ref={frameRef}
        className="reel-frame"
        style={{ ...fades, aspectRatio: fill ? undefined : `${sceneWidth} / ${sceneHeight}` } as CSSProperties}
      >
        <div
          ref={sceneRef}
          className="reel-scene"
          data-camera={framed ? 'framed' : 'full'}
          inert={!interactive}
          style={{
            width: sceneWidth,
            // A filled narrow scene is as tall as its content, and the stage scrolls it.
            height: scrolls ? undefined : sceneHeight,
            minHeight: scrolls ? height / fit : undefined,
            transform: `scale(${scale}) translate(${camera.x}px, ${camera.y}px)`,
          }}
        >
          <SceneView
            adapter={adapter}
            state={state}
            send={send}
            interactive={interactive}
            layout={layout}
          />
        </div>
        {/* Drawn over the scene and moved with it. None of it is part of the app. */}
        <div
          className="reel-over"
          aria-hidden="true"
          style={{ width: sceneWidth, height: scrolls ? undefined : sceneHeight, transform: `scale(${scale}) translate(${camera.x}px, ${camera.y}px)` }}
        >
          {veils.map(({ id, rect, strength }) => (
            <i
              key={id}
              className="reel-veil"
              style={{
                left: rect.x - SUBJECT_ROOM,
                top: rect.y - SUBJECT_ROOM,
                width: rect.width + SUBJECT_ROOM * 2,
                height: rect.height + SUBJECT_ROOM * 2,
                opacity: strength,
              }}
            />
          ))}
          {marks.map((mark) => (
            <i
              key={`${mark.x}:${mark.y}:${mark.width}:${mark.height}`}
              className="reel-mark"
              style={{ left: mark.x - 3, top: mark.y - 3, width: mark.width + 6, height: mark.height + 6 }}
            />
          ))}
          {under !== undefined && typed === null && (
            <i
              className="reel-press"
              style={{ left: under.x, top: under.y, width: under.width, height: under.height, opacity: press }}
            />
          )}
          {typed !== null && typing !== null && (
            <>
              <i
                className="reel-focus"
                style={{
                  left: typed.host.x,
                  top: typed.host.y,
                  width: typed.host.width,
                  height: typed.host.height,
                  borderRadius: typed.hostRadius,
                }}
              />
              <span
                className="reel-typed"
                data-selecting={typing.selecting}
                style={{ ...typed.style, left: typed.box.x, top: typed.box.y, width: typed.box.width, height: typed.box.height }}
              >
                <span>{typing.selecting ? typed.old : typing.text.slice(0, typing.keys)}</span>
                <i />
              </span>
            </>
          )}
        </div>
        {against !== undefined && (
          // A form of its own, so that its radio buttons never join a group in the scene.
          <form ref={twinRef} hidden inert>
            <SceneView adapter={adapter} state={against} send={ignoreSend} interactive={false} layout={layout} />
          </form>
        )}
        {framed && <i className="reel-fade" aria-hidden="true" />}
        {cursor !== null && pointer !== null && (
          <div
            className="reel-cursor"
            aria-hidden="true"
            // Near the bottom or the right edge its name goes where there is room for it.
            data-up={!scrolls && cursor.y > height - 46}
            data-back={cursor.x > width - 64}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, '--press': press } as CSSProperties}
          >
            {ripple !== null && (
              <i
                className="reel-ripple"
                style={{ transform: `scale(${0.35 + (1 - (1 - ripple) ** 3) * 1.1})`, opacity: (1 - ripple) ** 2 * 0.9 }}
              />
            )}
            <svg viewBox="0 0 22 24" width="22" height="24" aria-hidden="true">
              <path d="M3 2.2 18.4 13l-6.9 1.1-3.6 6.3L3 2.2Z" />
            </svg>
            <span>{pointer.label}</span>
          </div>
        )}
      </div>
      {/*
        A caption is set under the picture, where subtitles go, so it can never cover the
        control it describes. The strip keeps its height when empty, so nothing below it
        shifts between captions. A filled stage leaves the line to its host.
      */}
      {!fill && <figcaption className="reel-caption-strip">{caption?.text ?? ''}</figcaption>}
    </figure>
  );
}
