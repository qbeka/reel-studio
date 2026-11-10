import { type ReactNode, type Ref, memo } from 'react';
import type { AnyAdapter, LayoutName } from '../core/adapter';
import type { Rect } from '../core/camera';

const ignore = () => {};

/** The scene itself, drawn again only when its state is a different one. */
const MiniScene = memo(function MiniScene({
  adapter,
  state,
  layout,
}: {
  adapter: AnyAdapter;
  state: unknown;
  layout: LayoutName;
}) {
  const { Render } = adapter;
  return <Render state={state} send={ignore} interactive={false} layout={layout} />;
});

export interface MiniProps {
  adapter: AnyAdapter;
  state: unknown;
  /** The width it is shown at, in pixels. The scene keeps its real size and is scaled to this. */
  width: number;
  /** The height of the scene before scaling. Defaults to the shortest the scene allows. */
  sceneHeight?: number;
  layout?: LayoutName;
  /** Parts to outline, in scene coordinates. */
  marks?: readonly Rect[];
  /** Receives the element holding the scene, for reading what it shows. */
  sceneRef?: Ref<HTMLFormElement>;
  children?: ReactNode;
}

/**
 * The real scene at a small size. It is the same component the stage runs, given a state,
 * so what it shows is that state and not a picture of it. It takes no input and is hidden
 * from assistive technology, because the stage is the app a person uses.
 */
export function Mini({ adapter, state, width, sceneHeight, layout = 'wide', marks, sceneRef, children }: MiniProps) {
  const authored = adapter.layouts[layout];
  const height = sceneHeight ?? (layout === 'wide' ? (adapter.compactHeight ?? authored.height) : authored.height);
  const scale = width / authored.width;
  return (
    <div
      className="reel-mini"
      aria-hidden="true"
      data-chrome={adapter.chrome ?? 'light'}
      style={{ width, height: Math.round(height * scale) }}
    >
      {/* A form of its own, so that radio buttons here never join a group on the stage. */}
      <form
        className="reel-mini-scene"
        ref={sceneRef}
        inert
        style={{ width: authored.width, height, transform: `scale(${scale})` }}
      >
        <MiniScene adapter={adapter} state={state} layout={layout} />
      </form>
      {marks !== undefined && marks.length > 0 && (
        <div className="reel-mini-marks" style={{ width: authored.width, height, transform: `scale(${scale})` }}>
          {marks.map((mark) => (
            <i
              key={`${mark.x}:${mark.y}:${mark.width}:${mark.height}`}
              style={{ left: mark.x - 3, top: mark.y - 3, width: mark.width + 6, height: mark.height + 6, borderWidth: 1.5 / scale }}
            />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
