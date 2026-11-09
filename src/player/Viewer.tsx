import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AnyAdapter, LayoutName, LogEntry, Payload } from '../core/adapter';
import {
  type Branch,
  type BranchCopy,
  type ReturnOption,
  editCount,
  isUnchanged,
  matchesStory,
  openBranch,
  reopenBranch,
  returnOptions,
} from '../core/branch';
import { momentHash, parseMoment } from '../core/location';
import { Playback } from '../core/playback';
import { pointerAt, userCommands } from '../core/pointer';
import { type ReelProject, forViewer, formatTime, playRange } from '../core/project';
import { browserHost } from '../core/session';
import { Timeline } from '../core/timeline';
import { captionAt, chapterIndexAt, shotMixAt } from '../core/tracks';
import type { TranscriptLine } from '../core/transcript';
import { Handoff, type HandoffHandle } from './Handoff';
import { Stage, type StagePointer } from './Stage';
import { TimelineBar } from './Transport';

const STEP_MS = 5000;
/** How long the camera takes to leave or rejoin its shots when Full view is pressed. */
const FOLLOW_MS = 520;
const COPIED_MS = 1800;

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when a key press belongs to the focused control, not to the player. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, a, summary, [role="radio"], [role="tab"]') !== null
  );
}

/**
 * A number that eases to its target, and can be sent somewhere else on the way. With
 * reduced motion it is simply the target.
 */
function useEased(target: number, ms: number): number {
  const [value, setValue] = useState(target);
  const live = useRef(target);
  useEffect(() => {
    if (live.current === target) return;
    if (prefersReducedMotion()) {
      live.current = target;
      setValue(target);
      return;
    }
    const from = live.current;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const p = Math.min(1, (now - started) / ms);
      // Starts at once and settles gently, which reads as a response to a press.
      live.current = from + (target - from) * (1 - (1 - p) ** 3);
      setValue(live.current);
      if (p < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An insecure page has no clipboard API, so fall back to a selection.
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(field);
    field.select();
    const done = document.execCommand('copy');
    field.remove();
    return done;
  }
}

/** A branch set aside by Back to demo, held in memory until the next Take over or page load. */
interface KeptCopy extends BranchCopy {
  edits: number;
  lines: readonly string[];
}

/** One recorded command, as a line an author can read. */
export interface AuthorStep {
  t: number;
  text: string;
  chapter: boolean;
}

/** What an authoring panel needs from the viewer it sits in. */
export interface AuthorContext {
  /** The command on screen, or null before the first one. */
  command: LogEntry | null;
  range: { start: number; end: number };
  steps: readonly AuthorStep[];
  /** Index of the step on screen, or -1 before the first one. */
  current: number;
  seek: (t: number) => void;
  close: () => void;
}

export interface ViewerProps {
  adapter: AnyAdapter;
  project: ReelProject;
  transcript: readonly TranscriptLine[];
  /**
   * `full` is the exported page, `embed` the same in a host's frame, with a way back to the
   * poster. `page` is only the stage, for a host page that has its own title and links.
   */
  variant: 'full' | 'embed' | 'page';
  /** Starts playing on load. The viewer asked for it by activating an embed. */
  autoplay: boolean;
  /** Opens here instead of at a link or the poster. */
  startAt?: number;
  /** Adds an Author control. The exported viewer has none. */
  author?: (context: AuthorContext) => ReactNode;
}

const ICONS = {
  play: <path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7.1-4.6a.6.6 0 0 0 0-1L5.92 2.9a.6.6 0 0 0-.92.5Z" fill="currentColor" />,
  pause: <path d="M4.5 3h2.4v10H4.500V3Zm4.6 0h2.400v10H9.100V3Z" fill="currentColor" />,
  replay: (
    <path
      d="M3.2 8a4.8 4.8 0 1 0 1.5-3.500M3 2.700v2.600h2.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  link: (
    <path
      d="M6.7 9.300a2.7 2.7 0 0 0 3.8 0l2-2a2.7 2.7 0 0 0-3.8-3.800l-.6.6M9.3 6.700a2.7 2.7 0 0 0-3.8 0l-2 2a2.7 2.7 0 0 0 3.8 3.800l.6-.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  back: (
    <path
      d="M6.5 4 3 7.5 6.5 11M3.5 7.500H10a3 3 0 0 1 0 6H8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Viewer({ adapter, project, transcript, variant, autoplay, startAt, author }: ViewerProps) {
  const onPage = variant === 'page';
  const { start: rangeStart, end: rangeEnd } = playRange(project);
  const range = useMemo(() => ({ start: rangeStart, end: rangeEnd }), [rangeStart, rangeEnd]);
  const chapters = useMemo(() => forViewer(project).chapters, [project]);

  const { commands, seed, checkpointEvery, posterT } = project;
  const timeline = useMemo(
    () => new Timeline(adapter, commands, { seed, checkpointEvery }),
    [adapter, commands, seed, checkpointEvery],
  );

  // A shared link wins, then the host's choice. A viewer opening with nothing asked for
  // lands on the author's poster, not on an empty first moment. Chosen once, on load.
  const [{ opening, linked }] = useState(() => {
    const moment = parseMoment(location.hash, chapters, range);
    if (moment?.kind === 'time') return { opening: moment.t, linked: true };
    if (moment?.kind === 'chapter') {
      return { opening: chapters.find((c) => c.id === moment.id)!.t, linked: true };
    }
    return { opening: startAt ?? (autoplay ? range.start : posterT), linked: false };
  });
  const playback = useMemo(() => {
    const created = new Playback(timeline, range);
    // A short log seeks at once, so the first paint is already this moment.
    if (opening !== range.start) created.seek(opening);
    return created;
  }, [timeline, range, opening]);
  useEffect(() => () => playback.destroy(), [playback]);
  const story = useSyncExternalStore(playback.subscribe, playback.getSnapshot);

  const [framing, setFraming] = useState<'follow' | 'full'>(() => (prefersReducedMotion() ? 'full' : 'follow'));
  /**
   * False while the opening frame is still as it loaded. A poster shows the whole scene,
   * like any thumbnail, and the camera joins in once the viewer plays or moves the story.
   */
  const [moved, setMoved] = useState(linked || autoplay);
  const [layout, setLayout] = useState<LayoutName>('wide');

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchState, setBranchState] = useState<unknown>(null);
  /** The state a branch started from, until its first change. */
  const [untouched, setUntouched] = useState<unknown>(null);
  const [branchEdits, setBranchEdits] = useState(0);
  const [branchLines, setBranchLines] = useState<readonly string[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** Take over was pressed during a seek. It runs once the seek has a state to fork. */
  const [controlWanted, setControlWanted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [kept, setKept] = useState<KeptCopy | null>(null);
  const [authoring, setAuthoring] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [copied, setCopied] = useState(false);
  /** True while the drawn pointer is on its way back from the viewer's hand. */
  const [returning, setReturning] = useState(false);
  const [offscreen, setOffscreen] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const takeOverButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const moments = useRef<HTMLFieldSetElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const handoff = useRef<HandoffHandle>(null);

  // Ambient motion stops while the stage is out of sight.
  useEffect(() => {
    // A recording that cannot play shows a message in place of the stage.
    if (box.current === null) return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry!.isIntersecting));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const enterBranch = useCallback(
    (
      make: (onChange: (state: unknown) => void) => Branch,
      edits: number,
      lines: readonly string[],
      fresh: boolean,
    ) => {
      let previous: unknown;
      const next: Branch = make((changed) => {
        const entry = next.session.log.at(-1);
        const text = entry === undefined ? null : adapter.describe(previous, entry, changed);
        previous = changed;
        setBranchState(changed);
        setUntouched(null);
        setBranchEdits(editCount(next.session.log) + edits);
        if (text !== null) setBranchLines((shown) => [...shown, text]);
        setRejected(null);
      });
      previous = next.session.state;
      playback.pause();
      // The drawn pointer goes to the viewer's own, before the stage stops drawing it.
      handoff.current?.give();
      // A waiting Take over is settled now, or it would replace this branch when its seek ends.
      setControlWanted(false);
      setBranch(next);
      setBranchState(next.session.state);
      setUntouched(fresh ? next.session.state : null);
      setBranchEdits(edits);
      setBranchLines(lines);
      setRejected(null);
      setChoosing(false);
      setNotice(null);
      setKept(null);
      setAuthoring(false);
      setReturning(false);
      setAnnouncement('Your own copy is open, and the recording will not change');
      requestAnimationFrame(() => line.current?.focus({ preventScroll: true }));
    },
    [adapter, playback],
  );

  const takeControl = useCallback(() => {
    const { state, t, seeking } = playback.getSnapshot();
    // During a seek the snapshot pairs the requested time with the previous state, and a
    // fork from that pair would be wrong. The fork waits for the seek to finish.
    if (seeking) {
      setControlWanted(true);
      return;
    }
    enterBranch((onChange) => openBranch(adapter, state, t, browserHost, onChange), 0, [], true);
  }, [adapter, playback, enterBranch]);

  useEffect(() => {
    if (controlWanted && !story.seeking && branch === null) {
      setControlWanted(false);
      takeControl();
    }
  }, [controlWanted, story.seeking, branch, takeControl]);

  const send = useCallback(
    (type: string, payload?: Payload) => {
      if (branch === null) return;
      const result = branch.session.send(type, payload);
      if (!result.ok) setRejected(result.reason);
    },
    [branch],
  );

  const resetBranch = () => {
    if (branch === null || branchEdits === 0) return;
    const { t } = branch.base;
    branch.session.close();
    enterBranch(
      (onChange) => openBranch(adapter, timeline.stateAt(t), t, browserHost, onChange),
      0,
      [],
      true,
    );
  };

  const closeMoments = useCallback(() => {
    setChoosing(false);
    requestAnimationFrame(() => chooseButton.current?.focus({ preventScroll: true }));
  }, []);

  const openMoments = () => {
    if (choosing) {
      closeMoments();
      return;
    }
    setChoosing(true);
    requestAnimationFrame(() => moments.current?.focus({ preventScroll: true }));
  };

  // Computed from the live state, so an outcome arriving while the list is open cannot
  // leave a promise on screen that is no longer true.
  const options = useMemo(
    () => (choosing ? returnOptions(adapter, timeline, chapters, branchState) : []),
    [choosing, adapter, timeline, chapters, branchState],
  );

  const leaveBranch = (t: number) => {
    if (branch === null) return;
    const state = branch.session.state;
    const lost =
      branchEdits > 0 && !isUnchanged(adapter, branch) && !matchesStory(adapter, timeline, t, state);
    const copy: KeptCopy = {
      state,
      base: branch.base,
      t: branch.session.t,
      edits: branchEdits,
      lines: branchLines,
    };
    branch.session.close();
    setBranch(null);
    setChoosing(false);
    playback.seek(t);
    setKept(lost ? copy : null);
    const sentence = lost
      ? `Back at ${formatTime(t)}, with your copy set aside until you take over or leave`
      : `Back at ${formatTime(t)}, with nothing to set aside`;
    setNotice(sentence);
    setAnnouncement(sentence);
    if (!onPage) history.replaceState(null, '', momentHash(t));
    // On a host page Full view exists only in a branch, so the story gets its camera back.
    else if (!prefersReducedMotion()) setFraming('follow');
    // The pointer leaves the viewer's hand and goes back to where the story has it.
    setReturning(handoff.current?.takeBack(() => setReturning(false)) ?? false);
    requestAnimationFrame(() => takeOverButton.current?.focus({ preventScroll: true }));
  };

  const restoreCopy = () => {
    if (kept === null) return;
    const copy = kept;
    playback.seek(copy.base.t);
    enterBranch(
      (onChange) => reopenBranch(adapter, copy, browserHost, onChange),
      copy.edits,
      copy.lines,
      false,
    );
  };

  const playOrPause = useCallback(() => {
    setNotice(null);
    const snapshot = playback.getSnapshot();
    if (snapshot.playing) {
      playback.pause();
      return;
    }
    // The opening frame is a poster, so the first press of Play tells the story from its start.
    if (!moved && snapshot.t === opening && opening !== range.start) playback.seek(range.start);
    setMoved(true);
    playback.play();
  }, [playback, moved, opening, range]);

  const seek = useCallback(
    (t: number) => {
      setNotice(null);
      setMoved(true);
      playback.seek(t);
    },
    [playback],
  );

  const toggleAuthor = () => {
    playback.pause();
    setNotice(null);
    setAuthoring((open) => !open);
  };
  const closeAuthor = useCallback(() => setAuthoring(false), []);

  const copyLink = async () => {
    const { t } = playback.getSnapshot();
    const address = `${location.origin}${location.pathname}${location.search}${momentHash(t)}`;
    const done = await copyText(address);
    setCopied(done);
    setAnnouncement(done ? `Link to ${formatTime(t)} copied` : 'The link could not be copied');
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (autoplay && !prefersReducedMotion()) playback.play();
    // Activating an embed must not make the host page jump.
    if (autoplay) playButton.current?.focus({ preventScroll: true });
  }, [playback, autoplay]);

  const inBranch = branch !== null;
  const chapterIndex = chapterIndexAt(chapters, story.t);

  const jumpChapter = useCallback(
    (direction: 1 | -1) => {
      const { t } = playback.getSnapshot();
      const index = chapterIndexAt(chapters, t);
      // Going back from just inside a chapter restarts it. Further back moves to the last.
      const restart = direction < 0 && index >= 0 && t - chapters[index]!.t > 1500;
      const target = chapters[restart ? index : index + direction];
      if (target !== undefined) seek(target.t);
      else if (direction < 0) seek(range.start);
    },
    [chapters, seek, playback, range],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeys(event.target) || inBranch || authoring) return;
      if (onPage) {
        // On a page with reading below, the keys belong to the page once the stage has left.
        const bounds = box.current?.getBoundingClientRect();
        if (bounds === undefined || bounds.bottom < 80 || bounds.top > innerHeight - 80) return;
      }
      const key = event.key;
      if (key === ' ' || key === 'k') {
        event.preventDefault();
        playOrPause();
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        seek(playback.getSnapshot().t - STEP_MS);
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        seek(playback.getSnapshot().t + STEP_MS);
      } else if (key === '[') {
        jumpChapter(-1);
      } else if (key === ']') {
        jumpChapter(1);
      } else if (key === 't') {
        takeControl();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inBranch, authoring, onPage, playback, seek, playOrPause, jumpChapter, takeControl]);

  useEffect(() => {
    if (onPage || story.playing || story.seeking || inBranch) return;
    // The poster needs no address of its own. A moment someone linked to keeps its link.
    const atPoster = !linked && story.t === opening;
    const hash = story.t > range.start && !atPoster ? momentHash(story.t) : '';
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }, [onPage, opening, linked, story.playing, story.seeking, story.t, inBranch, range.start]);

  useEffect(() => {
    if (!choosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMoments();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (moments.current?.contains(target) || chooseButton.current?.contains(target)) return;
      setChoosing(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [choosing, closeMoments]);

  const steps = useMemo<AuthorStep[]>(
    () =>
      transcript.flatMap((entry) =>
        entry.kind === 'step'
          ? [{ t: entry.t, text: entry.text, chapter: chapters.some((c) => c.t === entry.t) }]
          : [],
      ),
    [transcript, chapters],
  );
  const stepTimes = useMemo(() => commands.map((c) => c.t), [commands]);
  const made = useMemo(() => userCommands(commands), [commands]);

  const shownT = inBranch ? branch.base.t : story.t;
  let current = -1;
  for (let i = 0; i < steps.length && steps[i]!.t <= shownT; i++) current = i;

  const last = story.count > 0 ? commands[story.count - 1] : undefined;
  const authorContext = useMemo<AuthorContext>(
    () => ({ command: last ?? null, range, steps, current, seek, close: closeAuthor }),
    [last, range, steps, current, seek, closeAuthor],
  );

  // The camera follows its shots once the story has moved, unless Full view is on.
  // An author picks a framing on a still frame, so there the camera shows where it settles.
  const moving = shotMixAt(project.camera, shownT);
  const shot = authoring ? { ...moving, progress: 1 } : moving;
  const follow = useEased(framing === 'follow' && moved ? 1 : 0, FOLLOW_MS);
  /** True when this moment has a close view, whether or not the viewer is looking through it. */
  const hasCloseView = moved && layout === 'wide' && shot.to !== null;

  // The pointer is drawn from the commands. Nothing recorded where a hand really was.
  const plan = pointerAt(made, story.t, range.start);
  const placeOf = (command: LogEntry | null) =>
    command === null ? null : (adapter.pointOf?.(command) ?? adapter.targetOf(command));
  const pointer: StagePointer | null =
    inBranch || made.length === 0
      ? null
      : {
          from: placeOf(plan.from),
          to: placeOf(plan.to),
          progress: plan.progress,
          sinceClick: plan.sinceClick,
          label: 'Reel',
        };

  if (story.error !== null) {
    return (
      <main className="reel-viewer">
        <h1>{project.title}</h1>
        <p className="reel-problem" role="alert">
          This recording cannot play past this point: {story.error}
        </p>
        <p>
          <a href="./transcript.html">Read the transcript</a>
        </p>
      </main>
    );
  }

  // Scene transient marks are not part of a state's data, so a branch starts without them.
  // Until something changes, the recording's own state stays on screen. Both hold the same
  // data, and this is what keeps taking over from changing a single pixel.
  const scene = !inBranch ? story.state : branchState === untouched ? story.state : branchState;
  const caption = inBranch ? null : captionAt(project.captions, story.t);
  const chapterTitle = chapterIndex >= 0 ? chapters[chapterIndex]!.title : '';
  // A narrow stage has no room for a callout, so the caption takes the title bar instead.
  const narration = inBranch
    ? branchEdits === 0
      ? ', and the recording stays as it is'
      : `, with ${branchEdits} ${branchEdits === 1 ? 'edit' : 'edits'} the recording never sees`
    : (notice ?? (layout === 'narrow' ? (caption?.text ?? '') : ''));

  const ended =
    !inBranch && !authoring && !story.playing && !story.seeking && story.t >= range.end && range.end > range.start;

  // Also offered in a branch: the camera holds its framing there, and this opens the rest.
  // A host page has no room to spare for it while the story plays, so there it appears
  // only for a viewer who took over inside a close view.
  const fullView = (onPage ? inBranch && hasCloseView : true) && (
    <button
      type="button"
      className="control"
      aria-pressed={framing === 'full'}
      onClick={() => setFraming(framing === 'full' ? 'follow' : 'full')}
    >
      Full view
    </button>
  );

  const stage = (
    <div
      className="reel-box"
      ref={box}
      data-mode={inBranch ? 'branch' : 'story'}
      data-author={authoring}
      data-layout={layout}
      data-playing={story.playing}
      data-offscreen={offscreen}
      data-returning={returning}
      onPointerMove={(event) => handoff.current?.track(event)}
      onPointerDown={(event) => handoff.current?.track(event)}
      onPointerLeave={() => handoff.current?.forget()}
    >
      <div className="reel-work">
        {inBranch && <i className="reel-claim" aria-hidden="true" />}
        <div className="reel-window">
          <div className="reel-line" data-quiet={!inBranch && narration === ''}>
            <span className="reel-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <p className="reel-narration" ref={line} tabIndex={-1}>
              {inBranch && <strong>This is your copy</strong>}
              {narration}
            </p>
            <span className="reel-address" aria-hidden="true">
              {adapter.address ?? adapter.title}
            </span>
            <p className="reel-tag" data-live={inBranch}>
              <i aria-hidden="true" />
              {inBranch ? 'Live' : 'Recorded'}, synthetic data
            </p>
          </div>
          <div className="reel-app">
            <Stage
              fill
              adapter={adapter}
              state={scene}
              interactive={inBranch}
              send={send}
              shot={shot}
              follow={follow}
              caption={authoring ? null : caption}
              pointer={pointer}
              onLayout={setLayout}
              label={`${project.title}, ${inBranch ? 'your copy' : 'recorded story'}`}
            />
          </div>
          {ended && (
            <div className="reel-end">
              <p>The story ends here and the app is yours to try</p>
              <button type="button" className="control primary" onClick={takeControl}>
                Try it yourself
              </button>
            </div>
          )}
        </div>

        {authoring && <aside className="reel-author float">{author?.(authorContext)}</aside>}

        {choosing && inBranch && (
          <fieldset className="reel-moments float" ref={moments} tabIndex={-1} aria-label="Choose a moment">
            <p>The recording resumes at the moment you pick, and your copy is never merged into it</p>
            <ul>
              <li>
                <button type="button" className="control" onClick={() => leaveBranch(branch.base.t)}>
                  <span>{formatTime(branch.base.t)}</span>
                  <span>Where you took over</span>
                </button>
              </li>
              {options.map(({ chapter, matches }: ReturnOption) => (
                <li key={chapter.id}>
                  <button type="button" className="control" onClick={() => leaveBranch(chapter.t)}>
                    <span>{formatTime(chapter.t)}</span>
                    <span>{chapter.title}</span>
                    {matches && <small>Matches your copy</small>}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="control"
              aria-disabled={branchEdits === 0}
              onClick={resetBranch}
            >
              Reset my changes
            </button>
          </fieldset>
        )}
      </div>

      <div
        className="reel-bar"
        data-seeking={story.seeking}
        data-t={story.t}
        data-state-t={story.stateT}
      >
        <TimelineBar
          labels
          range={range}
          t={shownT}
          chapters={chapters}
          steps={stepTimes}
          onSeek={seek}
          disabled={inBranch}
          tracks={authoring ? project : null}
          fork={
            inBranch
              ? { t: branch.base.t, edits: branchEdits, kept: false }
              : kept !== null
                ? { t: kept.base.t, edits: kept.edits, kept: true }
                : null
          }
        />

        {inBranch ? (
          <div className="reel-controls">
            <button type="button" className="control primary" onClick={() => leaveBranch(branch.base.t)}>
              <Icon name="back" />
              Back to demo
            </button>
            <button
              ref={chooseButton}
              type="button"
              className="control outline"
              aria-expanded={choosing}
              onClick={openMoments}
            >
              Choose a moment
            </button>
            {rejected !== null ? (
              <p className="reel-problem" role="alert">
                {rejected}
              </p>
            ) : (
              <span className="reel-time">
                From {formatTime(branch.base.t)}
                {branchLines.length > 0 && <span>{branchLines.at(-1)}</span>}
              </span>
            )}
            <span className="reel-spacer" />
            {fullView}
          </div>
        ) : (
          <div className="reel-controls">
            <button
              ref={playButton}
              type="button"
              className="control outline reel-play"
              aria-disabled={authoring}
              onClick={() => {
                if (!authoring) playOrPause();
              }}
            >
              <span data-on={!story.playing && story.t < range.end}>
                <Icon name="play" />
                Play
              </span>
              <span data-on={story.playing}>
                <Icon name="pause" />
                Pause
              </span>
              <span data-on={!story.playing && story.t >= range.end}>
                <Icon name="replay" />
                Replay
              </span>
            </button>
            <span className="reel-time">
              {formatTime(story.t)} <span>/ {formatTime(range.end)}</span>
            </span>
            <span className="reel-now">{chapterTitle}</span>
            <span className="reel-spacer" />
            {kept !== null && (
              <button type="button" className="control outline" onClick={restoreCopy}>
                Bring my copy back
              </button>
            )}
            <button type="button" className="control reel-copy" onClick={copyLink}>
              <Icon name="link" />
              <span data-on={!copied}>Copy link</span>
              <span data-on={copied}>Copied</span>
            </button>
            {fullView}
            {author !== undefined && (
              <button type="button" className="control" aria-pressed={authoring} onClick={toggleAuthor}>
                Author
              </button>
            )}
            <button
              ref={takeOverButton}
              type="button"
              className={ended ? 'control outline' : 'control primary'}
              aria-disabled={authoring}
              onClick={() => {
                if (!authoring) takeControl();
              }}
            >
              Take over
            </button>
          </div>
        )}
      </div>

      <Handoff ref={handoff} box={box} />

      <div className="sr-only" role="status">
        {announcement}
      </div>
    </div>
  );

  if (onPage) return stage;

  return (
    <main className="reel-viewer" data-embedded={variant === 'embed'}>
      {variant === 'embed' ? (
        <p className="reel-embed-head">
          <span className="reel-disclosure">{project.disclosure}</span>
          <a href="./embed.html">Close the demo</a>
          <a href="./transcript.html">Transcript</a>
        </p>
      ) : (
        <header className="reel-head">
          <h1>{project.title}</h1>
          <p className="reel-disclosure">{project.disclosure}</p>
        </header>
      )}

      <section className="stage" aria-label={project.title}>
        {stage}
      </section>

      {variant === 'full' && (
        <div className="reel-lower">
          <details className="reel-keys">
            <summary>Keyboard</summary>
            <dl>
              <dt>Space or K</dt>
              <dd>Play or pause</dd>
              <dt>Left and Right</dt>
              <dd>Back or forward 5 seconds</dd>
              <dt>[ and ]</dt>
              <dd>Previous or next chapter</dd>
              <dt>T</dt>
              <dd>Take over</dd>
            </dl>
            <p>Keys do nothing while you type in a field or use a control</p>
          </details>
          <a className="quiet" href="./transcript.html">
            Read the transcript
          </a>
        </div>
      )}
    </main>
  );
}
