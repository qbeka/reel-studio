import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AnyAdapter, Payload } from '../core/adapter';
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
import { type Chapter, type ReelProject, forViewer, formatTime, playRange } from '../core/project';
import { browserHost } from '../core/session';
import { Timeline } from '../core/timeline';
import { captionAt, chapterIndexAt, shotAt } from '../core/tracks';
import type { TranscriptLine } from '../core/transcript';
import { type Framing, Stage } from './Stage';
import { Transcript } from './Transcript';
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

/** A cleared branch, held in memory until the viewer presses Try it or leaves the page. */
interface KeptCopy extends BranchCopy {
  edits: number;
}

export interface ViewerProps {
  adapter: AnyAdapter;
  project: ReelProject;
  transcript: readonly TranscriptLine[];
  /** Embedded viewers offer a way back to the poster, which unloads the viewer. */
  embedded: boolean;
  /** Starts playing on load. The viewer asked for it by activating an embed. */
  autoplay: boolean;
}

export function Viewer({ adapter, project, transcript, embedded, autoplay }: ViewerProps) {
  const range = useMemo(() => playRange(project), [project]);
  const timeline = useMemo(
    () =>
      new Timeline(adapter, project.commands, {
        seed: project.seed,
        checkpointEvery: project.checkpointEvery,
      }),
    [adapter, project],
  );
  const playback = useMemo(() => new Playback(timeline, range), [timeline, range]);
  useEffect(() => () => playback.destroy(), [playback]);
  const story = useSyncExternalStore(playback.subscribe, playback.getSnapshot);

  const seekTo = useCallback((t: number) => playback.seek(t), [playback]);
  const [framing, setFraming] = useState<Framing>(() =>
    prefersReducedMotion() ? 'full' : 'follow',
  );

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchState, setBranchState] = useState<unknown>(null);
  const [branchEdits, setBranchEdits] = useState(0);
  const [rejected, setRejected] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  /** Try it was pressed during a seek. It runs once the seek has a state to fork. */
  const [controlWanted, setControlWanted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [kept, setKept] = useState<KeptCopy | null>(null);

  const playButton = useRef<HTMLButtonElement>(null);
  const returnPanel = useRef<HTMLFieldSetElement>(null);
  const tryButton = useRef<HTMLButtonElement>(null);
  const branchStatus = useRef<HTMLParagraphElement>(null);

  const enterBranch = useCallback(
    (make: (onChange: (state: unknown) => void) => Branch, edits: number) => {
      const next: Branch = make((changed) => {
        setBranchState(changed);
        setBranchEdits(editCount(next.session.log) + edits);
        setRejected(null);
      });
      playback.pause();
      setBranch(next);
      setBranchState(next.session.state);
      setBranchEdits(edits);
      setRejected(null);
      setReturning(false);
      setNotice(null);
      setKept(null);
    },
    [playback],
  );

  const takeControl = useCallback(() => {
    const { state, t, seeking } = playback.getSnapshot();
    // During a seek the snapshot pairs the requested time with the previous state, and a
    // fork from that pair would be wrong. The fork waits for the seek to finish.
    if (seeking) {
      setControlWanted(true);
      return;
    }
    enterBranch((onChange) => openBranch(adapter, state, t, browserHost, onChange), 0);
    requestAnimationFrame(() => branchStatus.current?.focus());
  }, [adapter, playback, enterBranch]);

  useEffect(() => {
    if (controlWanted && !story.seeking) {
      setControlWanted(false);
      takeControl();
    }
  }, [controlWanted, story.seeking, takeControl]);

  const send = useCallback(
    (type: string, payload?: Payload) => {
      if (branch === null) return;
      const result = branch.session.send(type, payload);
      if (!result.ok) setRejected(result.reason);
    },
    [branch],
  );

  const resetBranch = () => {
    if (branch === null) return;
    const { t } = branch.base;
    branch.session.close();
    enterBranch(
      (onChange) => openBranch(adapter, timeline.stateAt(t), t, browserHost, onChange),
      0,
    );
  };

  const askToReturn = () => {
    if (branch === null) return;
    setReturning(true);
    requestAnimationFrame(() => returnPanel.current?.focus());
  };

  const chapters = useMemo(() => forViewer(project).chapters, [project]);

  // Computed from the live state, so an outcome arriving while the panel is open cannot
  // leave a promise on screen that is no longer true.
  const options = useMemo(
    () => (returning ? returnOptions(adapter, timeline, chapters, branchState) : []),
    [returning, adapter, timeline, chapters, branchState],
  );

  const leaveBranch = (t: number, label: string) => {
    if (branch === null) return;
    const state = branch.session.state;
    const lost =
      branchEdits > 0 && !isUnchanged(adapter, branch) && !matchesStory(adapter, timeline, t, state);
    const copy: KeptCopy = { state, base: branch.base, t: branch.session.t, edits: branchEdits };
    branch.session.close();
    setBranch(null);
    setReturning(false);
    playback.seek(t);
    setKept(lost ? copy : null);
    setNotice(
      lost
        ? `Back in the story at ${label}. Your changes are cleared. The story is as recorded.`
        : `Back in the story at ${label}. Nothing was lost.`,
    );
    history.replaceState(null, '', momentHash(t));
    // The panel sat below the stage. Without this the viewer picks a chapter and is left
    // looking at the bottom of the page with the story above the fold.
    requestAnimationFrame(() => {
      document.querySelector('.reel-stage')?.scrollIntoView({ block: 'nearest' });
      tryButton.current?.focus({ preventScroll: true });
    });
  };

  const restoreCopy = () => {
    if (kept === null) return;
    const copy = kept;
    playback.seek(copy.base.t);
    enterBranch((onChange) => reopenBranch(adapter, copy, browserHost, onChange), copy.edits);
    requestAnimationFrame(() => branchStatus.current?.focus());
  };

  // Follow a shared link once, on load. `parseMoment` refuses anything unexpected.
  useEffect(() => {
    const moment = parseMoment(location.hash, chapters, range);
    if (moment?.kind === 'time') playback.seek(moment.t);
    if (moment?.kind === 'chapter') {
      playback.seek(chapters.find((c) => c.id === moment.id)!.t);
    }
    if (autoplay && !prefersReducedMotion()) playback.play();
    // Activating an embed must not make the host page jump.
    if (autoplay) playButton.current?.focus({ preventScroll: true });
  }, [playback, chapters, range, autoplay]);

  const inBranch = branch !== null;
  const chapterIndex = chapterIndexAt(chapters, story.t);

  const jumpChapter = useCallback(
    (direction: 1 | -1) => {
      const { t } = playback.getSnapshot();
      const index = chapterIndexAt(chapters, t);
      // Going back from just inside a chapter restarts it. Further back moves to the last.
      const restart = direction < 0 && index >= 0 && t - chapters[index]!.t > 1500;
      const target = chapters[restart ? index : index + direction];
      if (target !== undefined) playback.seek(target.t);
      else if (direction < 0) playback.seek(range.start);
    },
    [chapters, playback, range],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeys(event.target) || inBranch) return;
      const key = event.key;
      if (key === ' ' || key === 'k') {
        event.preventDefault();
        if (playback.getSnapshot().playing) playback.pause();
        else playback.play();
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        playback.seek(playback.getSnapshot().t - STEP_MS);
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        playback.seek(playback.getSnapshot().t + STEP_MS);
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
  }, [inBranch, playback, jumpChapter, takeControl]);

  useEffect(() => {
    if (!story.playing && !story.seeking && !inBranch && story.t > range.start) {
      history.replaceState(null, '', momentHash(story.t));
    }
  }, [story.playing, story.seeking, story.t, inBranch, range.start]);

  const last = story.count > 0 ? project.commands[story.count - 1] : undefined;
  const activeTarget =
    !inBranch && last !== undefined && story.t - last.t < RING_MS ? adapter.targetOf(last) : null;

  if (story.error !== null) {
    return (
      <main className="reel-viewer">
        <h1>{project.title}</h1>
        <p className="reel-problem" role="alert">
          This recording cannot play past this point. {story.error}
        </p>
        <p>
          <a href="./transcript.html">Read the transcript</a>
        </p>
      </main>
    );
  }

  return (
    <main
      className="reel-viewer"
      data-mode={inBranch ? 'branch' : 'story'}
      data-embedded={embedded}
    >
      {embedded ? (
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

      <Stage
        adapter={adapter}
        state={inBranch ? branchState : story.state}
        interactive={inBranch && !returning}
        send={send}
        cameraTarget={inBranch ? null : (shotAt(project.camera, story.t)?.target ?? null)}
        framing={framing}
        caption={inBranch ? null : captionAt(project.captions, story.t)}
        activeTarget={activeTarget}
        smooth={story.playing && framing === 'follow'}
        label={`${project.title}, ${inBranch ? 'your copy' : 'recorded story'}`}
      />

      <div
        className="reel-bar"
        data-seeking={story.seeking}
        data-t={story.t}
        data-state-t={story.stateT}
      >
        <TimelineBar
          range={range}
          t={inBranch ? branch.base.t : story.t}
          chapters={chapters}
          onSeek={(t) => playback.seek(t)}
          disabled={inBranch}
          fork={inBranch ? { t: branch.base.t, edits: branchEdits } : null}
        />

        {inBranch ? (
          <div className="reel-branch">
            <p className="reel-status" ref={branchStatus} tabIndex={-1} aria-live="polite">
              <strong>This is your copy.</strong> The story is paused at {formatTime(branch.base.t)}
              . {branchEdits === 0 ? 'Change anything.' : `${branchEdits} ${branchEdits === 1 ? 'edit' : 'edits'} so far.`}{' '}
              Nothing here changes the recording.
            </p>
            {rejected !== null && (
              <p className="reel-problem" role="alert">
                {rejected}
              </p>
            )}
            <div className="reel-actions">
              <button type="button" className="reel-button-quiet" onClick={resetBranch} disabled={branchEdits === 0}>
                Reset my changes
              </button>
              <button type="button" className="reel-button" onClick={askToReturn}>
                Return to story
              </button>
            </div>
          </div>
        ) : (
          <div className="reel-controls">
            <button
              ref={playButton}
              type="button"
              className="reel-button-ghost"
              onClick={() => (story.playing ? playback.pause() : playback.play())}
            >
              {story.playing ? 'Pause' : story.t >= range.end ? 'Replay' : 'Play'}
            </button>
            <span className="reel-time">
              {formatTime(story.t)} / {formatTime(range.end)}
            </span>
            <span className="reel-chapter" aria-live="off">
              {chapterIndex >= 0 ? chapters[chapterIndex]!.title : ''}
            </span>
            <span className="reel-spacer" />
            <label className="reel-toggle">
              <input
                type="checkbox"
                checked={framing === 'full'}
                onChange={(event) => setFraming(event.target.checked ? 'full' : 'follow')}
              />
              Full view
            </label>
            <button ref={tryButton} type="button" className="reel-button" onClick={takeControl}>
              Try it
            </button>
          </div>
        )}
      </div>

      {returning && branch !== null && (
        <ReturnPanel
          panelRef={returnPanel}
          options={options}
          pausedAt={branch.base.t}
          pausedMatches={matchesStory(adapter, timeline, branch.base.t, branchState)}
          hasEdits={branchEdits > 0 && !isUnchanged(adapter, branch)}
          onChoose={leaveBranch}
          onCancel={() => setReturning(false)}
        />
      )}

      {notice !== null && !inBranch && (
        <p className="reel-notice" role="status">
          {notice}{' '}
          {kept !== null && (
            <button type="button" className="reel-link" onClick={restoreCopy}>
              Bring my copy back
            </button>
          )}
        </p>
      )}

      <div className="reel-lower" hidden={embedded}>
        <Transcript lines={transcript} disabled={inBranch} onSeek={seekTo} />

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
            <dd>Try it</dd>
          </dl>
          <p>Keys do nothing while you type in a field or use a control.</p>
        </details>
      </div>
    </main>
  );
}

function ReturnPanel({
  panelRef,
  options,
  pausedAt,
  pausedMatches,
  hasEdits,
  onChoose,
  onCancel,
}: {
  panelRef: React.RefObject<HTMLFieldSetElement | null>;
  options: ReturnOption[];
  pausedAt: number;
  pausedMatches: boolean;
  hasEdits: boolean;
  onChoose: (t: number, label: string) => void;
  onCancel: () => void;
}) {
  const consequence = (matches: boolean) =>
    matches ? 'Matches your copy exactly.' : hasEdits ? 'Clears your changes.' : 'Nothing to clear.';
  const describeChapter = (chapter: Chapter) => `${formatTime(chapter.t)}, ${chapter.title}`;
  return (
    <fieldset className="reel-return" ref={panelRef} tabIndex={-1} aria-label="Return to the story">
      <h2>Where should the story resume?</h2>
      <p>
        The story always restores a recorded moment. Your copy is not merged into it.
      </p>
      <ul>
        <li>
          <button type="button" onClick={() => onChoose(pausedAt, formatTime(pausedAt))}>
            <span>{formatTime(pausedAt)}, where you paused</span>
            <small>{consequence(pausedMatches)}</small>
          </button>
        </li>
        {options.map(({ chapter, matches }) => (
          <li key={chapter.id}>
            <button type="button" onClick={() => onChoose(chapter.t, describeChapter(chapter))}>
              <span>{describeChapter(chapter)}</span>
              <small data-match={matches}>{consequence(matches)}</small>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="reel-button-quiet" onClick={onCancel}>
        Keep experimenting
      </button>
    </fieldset>
  );
}
