import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnyAdapter, LayoutName, Payload } from '../core/adapter';
import {
  type CameraTransform,
  FULL_VIEW,
  type Rect,
  frameRect,
  mixCamera,
  placeCallout,
  projectRect,
} from '../core/camera';
import { ease } from '../core/pointer';
import type { Caption } from '../core/project';
import type { ShotMix } from '../core/tracks';

/** Below this stage width a scene uses its narrow coordinate system. */
const NARROW_BELOW = 560;

/** Below this width a filled wide scene scales down, so its two columns keep their shape. */
const MIN_WIDE_WIDTH = 720;

/** Below this width a filled narrow scene scales down too, so a small phone shows all of each row. */
const MIN_NARROW_WIDTH = 344;

/** How long the ring of a click takes to spread and fade, in logical milliseconds. */
const RIPPLE_MS = 520;
/** The pointer dips for this long as it presses. */
const PRESS_MS = 140;

/** Room kept around the pointer when a narrow stage scrolls to follow it. */
const FOLLOW_ABOVE = 72;
const FOLLOW_BELOW = 96;

const SHOT_NONE: ShotMix = { from: null, to: null, progress: 1 };

/**
 * Layout bounds of every named target and control, in scene coordinates. Offsets ignore
 * CSS transforms, so bounds do not change while the camera moves or the stage rescales.
 */
function measureTargets(root: HTMLElement): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-reel-target], [data-reel-point]')) {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = element;
    while (node !== null && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    const rect = { x, y, width: element.offsetWidth, height: element.offsetHeight };
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
  /** Logical milliseconds since it last pressed, or null. */
  sinceClick: number | null;
  /** The short word it carries, saying who is moving it. */
  label: string;
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
  caption: Caption | null;
  /** The drawn pointer, or null for none. It is never a recording of a real one. */
  pointer?: StagePointer | null;
  /** Puts a stable, known layout on the stage for tests and screenshots. */
  label: string;
  onCommit?: () => void;
  /** Fills the parent box instead of keeping the scene's aspect ratio. */
  fill?: boolean;
  /** Told which coordinate system the scene is using, whenever that changes. */
  onLayout?: (layout: LayoutName) => void;
}

export function Stage({
  adapter,
  state,
  interactive,
  send = ignoreSend,
  shot = SHOT_NONE,
  follow = 1,
  caption,
  pointer = null,
  label,
  onCommit,
  fill = false,
  onLayout,
}: StageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<Map<string, Rect>>(() => new Map());
  const [calloutHeight, setCalloutHeight] = useState(64);

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
    const callout = calloutRef.current?.offsetHeight;
    if (callout !== undefined && callout > 0) setCalloutHeight(callout);
  });

  // A scene that scrolls is followed by scrolling, so its camera stays on the whole scene.
  const [shotFrom, shotTo] = useMemo(() => {
    if (scrolls) return [FULL_VIEW, FULL_VIEW];
    const size = { width: sceneWidth, height: sceneHeight };
    const frame = (target: string | null) =>
      target === null ? FULL_VIEW : frameRect(bounds.get(target) ?? null, size);
    return [frame(shot.from), frame(shot.to)];
  }, [scrolls, sceneWidth, sceneHeight, bounds, shot.from, shot.to]);
  const camera: CameraTransform = useMemo(
    () => mixCamera(FULL_VIEW, mixCamera(shotFrom, shotTo, ease(shot.progress)), follow),
    [shotFrom, shotTo, shot.progress, follow],
  );
  /** Where the camera will be once it stops. A callout picks its side from this. */
  const settled = follow >= 0.5 ? shotTo : FULL_VIEW;
  const scale = fit * camera.scale;
  const framed = camera.scale !== 1 || camera.x !== 0 || camera.y !== 0;

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
    const bow = Math.sin(Math.PI * pointer.progress) * Math.min(26, distance * 0.09);
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

  // The callout sits beside its target, level with the pointer. Its side comes from the
  // settled camera, so it does not change sides while the camera is still moving.
  const calloutWidth = Math.round(Math.min(288, Math.max(196, width * 0.29)));
  let callout: { x: number; y: number; side: string; tail: number } | null = null;
  if (caption !== null && layout === 'wide' && width > 0) {
    const anchor = caption.target === null ? undefined : bounds.get(caption.target);
    const fitted = { ...settled, scale: settled.scale * fit };
    const there = anchor === undefined ? null : projectRect(anchor, fitted);
    const focus = point === null ? null : toFrame(settled, point.x, point.y).y;
    const place = placeCallout(
      there,
      focus,
      { width, height },
      { width: calloutWidth, height: calloutHeight },
    );
    // Carried along with its target while the camera is on its way.
    const now = anchor === undefined || there === null ? null : toFrame(camera, anchor.x, anchor.y);
    const rides = place.side !== 'below' && now !== null && there !== null;
    callout = {
      ...place,
      x: place.x + (rides ? now.x - there.x : 0),
      y: place.y + (rides ? now.y - there.y : 0),
    };
  }

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
  const ripple = since !== null && since < RIPPLE_MS ? since / RIPPLE_MS : null;
  const pressed = since !== null && since < PRESS_MS;

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
        {framed && <i className="reel-fade" aria-hidden="true" />}
        {cursor !== null && pointer !== null && (
          <div
            className="reel-cursor"
            aria-hidden="true"
            data-pressed={pressed}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            {ripple !== null && (
              <i
                className="reel-ripple"
                style={{ transform: `scale(${0.3 + ripple * 1.5})`, opacity: (1 - ripple) ** 1.6 }}
              />
            )}
            <svg viewBox="0 0 22 24" width="22" height="24" aria-hidden="true">
              <path d="M3 2.2 18.4 13l-6.9 1.1-3.6 6.3L3 2.2Z" />
            </svg>
            <span>{pointer.label}</span>
          </div>
        )}
        {callout !== null && caption !== null && (
          <div
            ref={calloutRef}
            className="reel-caption"
            data-side={callout.side}
            style={{
              width: calloutWidth,
              transform: `translate(${Math.round(callout.x)}px, ${Math.round(callout.y)}px)`,
            }}
          >
            <p key={caption.id}>
              {caption.text}
              <i aria-hidden="true" style={{ top: callout.tail }} />
            </p>
          </div>
        )}
      </div>
      {/*
        On a narrow stage the caption has its own strip below the scene, so it can never
        cover the target and its text stays at a readable size. The strip keeps its
        height when empty, so the controls do not shift between captions.
      */}
      {layout === 'narrow' && !fill && (
        <figcaption className="reel-caption-strip">{caption?.text ?? ''}</figcaption>
      )}
    </figure>
  );
}
