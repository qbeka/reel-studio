import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
}: StageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [bounds, setBounds] = useState<Map<string, Rect>>(() => new Map());

  useLayoutEffect(() => {
    const frame = frameRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    setWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, []);

  const layout: LayoutName = width > 0 && width < NARROW_BELOW ? 'narrow' : 'wide';
  const size = adapter.layouts[layout];
  const fit = width > 0 ? width / size.width : 1;

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

  return (
    <figure className="reel-stage" aria-label={label} data-layout={layout}>
      <div
        ref={frameRef}
        className="reel-frame"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        <div
          ref={sceneRef}
          className="reel-scene"
          data-smooth={smooth}
          data-camera={camera === FULL_VIEW ? 'full' : 'framed'}
          inert={!interactive}
          style={{
            width: size.width,
            height: size.height,
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
      {layout === 'narrow' && (
        <figcaption className="reel-caption-strip">{caption?.text ?? ''}</figcaption>
      )}
    </figure>
  );
}
