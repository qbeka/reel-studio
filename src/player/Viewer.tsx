import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AnyAdapter, LogEntry, Payload } from '../core/adapter';
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
import { type ReelProject, forViewer, formatTime, playRange } from '../core/project';
import { browserHost } from '../core/session';
import { Timeline } from '../core/timeline';
import { captionAt, chapterIndexAt, shotAt } from '../core/tracks';
import type { TranscriptLine } from '../core/transcript';
import { Rail, type RailStep } from './Rail';
import { type Framing, Stage } from './Stage';
import { TimelineBar } from './Transport';

/** How long the ring stays on a target after a command, in logical milliseconds. */
const RING_MS = 900;
const STEP_MS = 5000;

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when a key press belongs to the focused control, not to the player. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, a, summary, [role="radio"], [role="tab"]') !== null
  );
}

/** A branch set aside by Back to demo, held in memory until the next Take over or page load. */
interface KeptCopy extends BranchCopy {
  edits: number;
  lines: readonly string[];
}

/** What an authoring panel needs from the viewer it sits in. */
export interface AuthorContext {
  /** The command on screen, or null before the first one. */
  command: LogEntry | null;
  range: { start: number; end: number };
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
    const moment = onPage ? null : parseMoment(location.hash, chapters, range);
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

  const [framing, setFraming] = useState<Framing>(() =>
    onPage || prefersReducedMotion() ? 'full' : 'follow',
  );

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

  const box = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const takeOverButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const moments = useRef<HTMLFieldSetElement>(null);
  const line = useRef<HTMLParagraphElement>(null);

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
    if (playback.getSnapshot().playing) playback.pause();
    else playback.play();
  }, [playback]);

  const seek = useCallback(
    (t: number) => {
      setNotice(null);
      playback.seek(t);
    },
    [playback],
  );

  const toggleAuthor = () => {
    playback.pause();
    setNotice(null);
    setAuthoring((open) => !open);
  };

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

  const steps = useMemo<RailStep[]>(
    () =>
      transcript.flatMap((entry) =>
        entry.kind === 'step'
          ? [{ t: entry.t, text: entry.text, chapter: chapters.some((c) => c.t === entry.t) }]
          : [],
      ),
    [transcript, chapters],
  );
  const stepTimes = useMemo(() => commands.map((c) => c.t), [commands]);

  const shownT = inBranch ? branch.base.t : story.t;
  let current = -1;
  for (let i = 0; i < steps.length && steps[i]!.t <= shownT; i++) current = i;

  const last = story.count > 0 ? commands[story.count - 1] : undefined;
  const activeTarget =
    !inBranch && last !== undefined && story.t - last.t < RING_MS ? adapter.targetOf(last) : null;

  const authorContext = useMemo<AuthorContext>(
    () => ({ command: last ?? null, range }),
    [last, range],
  );

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
  const caption = captionAt(project.captions, story.t);
  const narration = inBranch
    ? branchEdits === 0
      ? ', and the recording stays as it is'
      : `, with ${branchEdits} ${branchEdits === 1 ? 'edit' : 'edits'} the recording never sees`
    : (notice ?? caption?.text ?? '');

  // Also offered in a branch: the camera holds its framing there, and this opens the rest.
  const fullView = !onPage && (
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
    <div className="reel-box" ref={box} data-mode={inBranch ? 'branch' : 'story'} data-author={authoring}>
      <div className="reel-line">
        <p className="reel-narration" ref={line} tabIndex={-1}>
          {inBranch && <strong>This is your copy</strong>}
          {narration}
        </p>
        <p className="reel-tag" data-live={inBranch}>
          <i aria-hidden="true" />
          {inBranch ? 'Live' : 'Recorded'}, synthetic data
        </p>
      </div>

      <div className="reel-work">
        <div className="reel-app">
          <Stage
            fill
            adapter={adapter}
            state={scene}
            interactive={inBranch}
            send={send}
            cameraTarget={inBranch ? branchShot(project, branch.base.t) : (shotAt(project.camera, story.t)?.target ?? null)}
            framing={framing}
            caption={null}
            activeTarget={activeTarget}
            smooth={story.playing && !prefersReducedMotion()}
            label={`${project.title}, ${inBranch ? 'your copy' : 'recorded story'}`}
            handoff={
              inBranch || authoring
                ? null
                : {
                    target: adapter.handoffTarget?.(story.state) ?? null,
                    element: (
                      <button
                        ref={takeOverButton}
                        type="button"
                        className="control primary"
                        onClick={takeControl}
                      >
                        Take over
                      </button>
                    ),
                  }
            }
          />
        </div>

        {(steps.length > 0 || authoring) && (
          <aside className="reel-rail" aria-label="Steps">
            <Rail
              steps={steps}
              current={current}
              forkAt={inBranch ? current + 1 : null}
              mine={branchLines}
              onSeek={seek}
            />
            {authoring && author?.(authorContext)}
          </aside>
        )}

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
          range={range}
          t={shownT}
          chapters={chapters}
          steps={stepTimes}
          onSeek={seek}
          disabled={inBranch}
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
            {rejected !== null ? (
              <p className="reel-problem" role="alert">
                {rejected}
              </p>
            ) : (
              <span className="reel-time">From {formatTime(branch.base.t)}</span>
            )}
            <span className="reel-spacer" />
            {fullView}
            <button
              ref={chooseButton}
              type="button"
              className="control outline"
              aria-expanded={choosing}
              onClick={openMoments}
            >
              Choose a moment
            </button>
            <button type="button" className="control primary" onClick={() => leaveBranch(branch.base.t)}>
              Back to demo
            </button>
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
              <span data-on={!story.playing && story.t < range.end}>Play</span>
              <span data-on={story.playing}>Pause</span>
              <span data-on={!story.playing && story.t >= range.end}>Replay</span>
            </button>
            <span className="reel-time">
              {formatTime(story.t)} / {formatTime(range.end)}
            </span>
            <span className="reel-chapter">{chapterIndex >= 0 ? chapters[chapterIndex]!.title : ''}</span>
            <span className="reel-spacer" />
            {kept !== null && (
              <button type="button" className="control outline" onClick={restoreCopy}>
                Bring my copy back
              </button>
            )}
            {fullView}
            {author !== undefined && (
              <button type="button" className="control" aria-pressed={authoring} onClick={toggleAuthor}>
                Author
              </button>
            )}
          </div>
        )}
      </div>

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

/** The shot in force at a fork. The camera stays where it was, so nothing moves. */
function branchShot(project: ReelProject, t: number): string | null {
  return shotAt(project.camera, t)?.target ?? null;
}
