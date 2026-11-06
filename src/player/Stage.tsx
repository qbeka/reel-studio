import { type ReactNode, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnyAdapter, LayoutName, Payload } from '../core/adapter';
import {
  type CameraTransform,
  FULL_VIEW,
  type Rect,
  frameRect,
  placeCaption,
  projectRect,
} from '../core/camera';
import type { Caption } from '../core/project';

/** Below this stage width a scene uses its narrow coordinate system. */
const NARROW_BELOW = 560;

/** Estimated caption height in scene units, used only to choose an edge. */
const CAPTION_HEIGHT = 84;

/** Below this width a filled wide scene scales down, so its two columns keep their shape. */
const MIN_WIDE_WIDTH = 720;

/** Clear space kept around the Take over button, in stage pixels. */
const HANDOFF_GAP = 10;
const HANDOFF_WIDTH = 100;
const HANDOFF_HEIGHT = 36;

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Framing = 'follow' | 'full';

/**
 * Layout bounds of every named target, in scene coordinates. Offsets ignore CSS
 * transforms, so bounds do not change while the camera moves or the stage rescales.
 */
function measureTargets(root: HTMLElement): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-reel-target]')) {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = element;
    while (node !== null && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    const id = element.dataset.reelTarget!;
    bounds.set(id, { x, y, width: element.offsetWidth, height: element.offsetHeight });
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

export interface StageProps {
  adapter: AnyAdapter;
  state: unknown;
  interactive: boolean;
  send?: (type: string, payload?: Payload) => void;
  /** The target the camera should frame, or null for the full scene. */
  cameraTarget: string | null;
  framing: Framing;
  caption: Caption | null;
  /** The target the latest command acted on. Drawn as a thin ring. */
  activeTarget: string | null;
  /** Camera moves ease during playback and jump during a seek. */
  smooth: boolean;
  /** Puts a stable, known layout on the stage for tests and screenshots. */
  label: string;
  onCommit?: () => void;
  /** Fills the parent box instead of keeping the scene's aspect ratio. */
  fill?: boolean;
  /** Sits beside `target` in a filled stage, and scrolls with the scene. */
  handoff?: { target: string | null; element: ReactNode } | null;
}

export function Stage({
  adapter,
  state,
  interactive,
  send = ignoreSend,
  cameraTarget,
  framing,
  caption,
  activeTarget,
  smooth,
  label,
  onCommit,
  fill = false,
  handoff = null,
}: StageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<Map<string, Rect>>(() => new Map());

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
  let size = authored;
  let fit = width > 0 ? width / authored.width : 1;
  if (fill && width > 0 && height > 0) {
    if (layout === 'wide') {
      // Only ever scales down, so type stays at its real size when there is room.
      const shortest = adapter.compactHeight ?? authored.height;
      fit = Math.min(1, height / shortest, width / MIN_WIDE_WIDTH);
      size = { width: width / fit, height: height / fit };
    } else {
      // A narrow scene keeps its real size and scrolls inside the stage.
      fit = 1;
      size = { width, height: Math.max(height, authored.height) };
    }
  }

  // Runs after React has committed this state to the DOM, before the browser paints.
  useLayoutEffect(() => {
    onCommit?.();
    const measured = measureTargets(sceneRef.current!);
    setBounds((previous) => (sameBounds(previous, measured) ? previous : measured));
  });

  const camera: CameraTransform = useMemo(() => {
    if (framing === 'full' || cameraTarget === null) return FULL_VIEW;
    return frameRect(bounds.get(cameraTarget) ?? null, size);
  }, [framing, cameraTarget, bounds, size]);

  const captionTarget = caption?.target ? (bounds.get(caption.target) ?? null) : null;
  const shownTarget = captionTarget === null ? null : projectRect(captionTarget, camera);
  const placement = placeCaption(shownTarget, size.height, CAPTION_HEIGHT);

  const ring = activeTarget === null ? undefined : bounds.get(activeTarget);

  const anchor = handoff?.target ? bounds.get(handoff.target) : undefined;
  const handoffAt = useMemo(() => {
    if (!fill || anchor === undefined) return null;
    const scale = fit * camera.scale;
    const left = (anchor.x + camera.x) * scale;
    const top = (anchor.y + camera.y) * scale;
    const right = left + anchor.width * scale;
    const middle = top + (anchor.height * scale - HANDOFF_HEIGHT) / 2;
    return right + HANDOFF_GAP + HANDOFF_WIDTH <= width
      ? { x: right + HANDOFF_GAP, y: middle }
      : { x: left, y: top + anchor.height * scale + HANDOFF_GAP };
  }, [fill, anchor, fit, camera, width]);

  // In a stage too short for the whole scene, keeps the active field on screen. The viewer
  // sees the same scroll position when they take over, because the scene never moves.
  const followed = handoffAt?.y;
  useEffect(() => {
    if (!fill || layout !== 'narrow' || followed === undefined) return;
    const margin = 16;
    const top = followed + HANDOFF_HEIGHT + margin - height;
    frameRef.current!.scrollTo({
      top: Math.max(0, top),
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, [fill, layout, followed, smooth, height]);

  return (
    <figure className="reel-stage" aria-label={label} data-layout={layout} data-fill={fill}>
      <div
        ref={frameRef}
        className="reel-frame"
        style={fill ? undefined : { aspectRatio: `${size.width} / ${size.height}` }}
      >
        <div
          ref={sceneRef}
          className="reel-scene"
          data-smooth={smooth}
          data-camera={camera === FULL_VIEW ? 'full' : 'framed'}
          inert={!interactive}
          style={{
            width: size.width,
            // A filled narrow scene is as tall as its content, and the stage scrolls it.
            height: fill && layout === 'narrow' ? undefined : size.height,
            transform: `scale(${fit * camera.scale}) translate(${camera.x}px, ${camera.y}px)`,
          }}
        >
          <SceneView
            adapter={adapter}
            state={state}
            send={send}
            interactive={interactive}
            layout={layout}
          />
          {ring !== undefined && (
            <div
              className="reel-ring"
              aria-hidden="true"
              style={{
                left: ring.x - 4,
                top: ring.y - 4,
                width: ring.width + 8,
                height: ring.height + 8,
              }}
            />
          )}
        </div>
        {handoff !== null && (
          <div
            className="reel-handoff"
            data-placed={handoffAt !== null}
            data-smooth={smooth}
            style={handoffAt === null ? undefined : { transform: `translate(${handoffAt.x}px, ${handoffAt.y}px)` }}
          >
            {handoff.element}
          </div>
        )}
        {caption !== null && layout === 'wide' && (
          <p className="reel-caption" data-placement={placement}>
            {caption.text}
          </p>
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
