import { type Ref, type RefObject, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * The moment the pointer changes hands. While the story plays, the stage draws a pointer
 * of its own. When the viewer takes over, this carries that pointer from where the story
 * had it to where the viewer's real one is, and lets go. Going back, it leaves the
 * viewer's hand and returns to the story's place.
 *
 * It moves on a spring that is aimed again every frame, so a hand that keeps moving is
 * followed without a jump, and the speed it already has is kept.
 */
export interface HandoffHandle {
  /** Remembers where the viewer's own pointer is. Touch has none, so it is ignored. */
  track(event: { pointerType: string; clientX: number; clientY: number }): void;
  forget(): void;
  /** Story to viewer. Call before the stage stops drawing its pointer. */
  give(): void;
  /** Viewer to story. Returns true when a flight started, and calls `done` as it lands. */
  takeBack(done: () => void): boolean;
}

interface Point {
  x: number;
  y: number;
}

const STIFFNESS = 190;
/** Critical damping for that stiffness, so it arrives without overshooting. */
const DAMPING = 2 * Math.sqrt(STIFFNESS);
/** With nowhere to go it still shows whose pointer it now is, for this long. */
const HOLD_MS = 460;
const LIMIT_MS = 1400;
const FADE_MS = 180;

const STORY_POINTER = '.reel-frame > .reel-cursor';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Handoff({
  ref,
  box,
}: {
  ref: Ref<HandoffHandle>;
  box: RefObject<HTMLDivElement | null>;
}) {
  const ghost = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const hand = useRef<Point | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    clearTimeout(timer.current);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
    },
    [],
  );

  /** A point on the page, as a place inside the stage. */
  const inBox = (client: Point): Point => {
    const bounds = box.current!.getBoundingClientRect();
    return { x: client.x - bounds.left, y: client.y - bounds.top };
  };
  const storyPointer = (): Point | null => {
    const element = box.current?.querySelector(STORY_POINTER);
    if (element == null) return null;
    const bounds = element.getBoundingClientRect();
    return inBox({ x: bounds.left, y: bounds.top });
  };

  const fly = (from: Point, aim: () => Point | null, owner: 'you' | 'reel', landed?: () => void) => {
    const element = ghost.current!;
    stop();
    label.current!.textContent = owner === 'you' ? 'You' : 'Reel';
    element.dataset.owner = owner;
    element.hidden = false;
    element.style.opacity = '1';
    let { x, y } = from;
    let vx = 0;
    let vy = 0;
    const started = performance.now();
    let last = started;
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const to = aim() ?? { x, y };
      // Two half steps keep the spring steady when a frame runs long.
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        vx += (STIFFNESS * (to.x - x) - DAMPING * vx) * h;
        vy += (STIFFNESS * (to.y - y) - DAMPING * vy) * h;
        x += vx * h;
        y += vy * h;
      }
      element.style.transform = `translate(${x}px, ${y}px)`;
      const age = now - started;
      const there = Math.hypot(to.x - x, to.y - y) < 1.5 && Math.hypot(vx, vy) < 40;
      if ((there && age > HOLD_MS) || age > LIMIT_MS) {
        landed?.();
        element.style.opacity = '0';
        timer.current = setTimeout(() => {
          element.hidden = true;
        }, FADE_MS);
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    element.style.transform = `translate(${x}px, ${y}px)`;
    frame.current = requestAnimationFrame(step);
  };

  useImperativeHandle(ref, () => ({
    track(event) {
      hand.current = event.pointerType === 'touch' ? null : { x: event.clientX, y: event.clientY };
    },
    forget() {
      hand.current = null;
    },
    give() {
      const from = storyPointer();
      if (from === null || reducedMotion()) return;
      fly(from, () => (hand.current === null ? null : inBox(hand.current)), 'you');
    },
    takeBack(done) {
      if (hand.current === null || reducedMotion()) return false;
      fly(inBox(hand.current), storyPointer, 'reel', done);
      return true;
    },
  }));

  return (
    <div ref={ghost} className="reel-cursor reel-ghost" aria-hidden="true" hidden>
      <svg viewBox="0 0 22 24" width="22" height="24" aria-hidden="true">
        <path d="M3 2.2 18.4 13l-6.9 1.1-3.6 6.3L3 2.2Z" />
      </svg>
      <span ref={label}>You</span>
    </div>
  );
}
