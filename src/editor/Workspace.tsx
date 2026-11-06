import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AnyAdapter, Payload } from '../core/adapter';
import {
  type EditProposal,
  type History,
  appendCommands,
  commit,
  initialHistory,
  newTrackId,
  nextSeq,
  proposeEdit,
  redo,
  removeCommands,
  retimeCommand,
  setCommandPayload,
  undo,
  withoutBroken,
} from '../core/edit';
import { Playback } from '../core/playback';
import {
  type ReelProject,
  formatTime,
  projectEnd,
  validateProject,
} from '../core/project';
import { LiveSession, browserHost } from '../core/session';
import { Timeline as ReplayTimeline } from '../core/timeline';
import { captionAt, shotAt } from '../core/tracks';
import { downloadBytes, exportZip } from '../export/browser';
import { Stage } from '../player/Stage';
import { TimelineBar } from '../player/Transport';
import { type DraftStore, storageMessage } from '../storage/drafts';
import { Inspector } from './Inspector';
import { type Selection, Timeline } from './Timeline';

/** Autosave waits for a pause in editing. */
const AUTOSAVE_MS = 600;

/** Silence added between one recording pass and the next, in logical milliseconds. */
const RECORDING_GAP_MS = 500;

type SaveStatus = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'failed'; message: string };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select') !== null);

export function Workspace({
  adapter,
  initial,
  notice,
  drafts,
  onClose,
}: {
  adapter: AnyAdapter;
  initial: ReelProject;
  notice: string | null;
  drafts: DraftStore | null;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<History<ReelProject>>(() => initialHistory(initial));
  const project = history.present;
  const [selection, setSelection] = useState<Selection>(null);
  const [repair, setRepair] = useState<EditProposal | null>(null);
  const [save, setSave] = useState<SaveStatus>({ kind: 'saved', at: Date.now() });
  const [exporting, setExporting] = useState(false);

  // A new timeline is only needed when commands change. Captions and camera edits keep
  // their checkpoints, because they cannot affect scene state.
  const end = Math.max(projectEnd(project), 1000);
  const timeline = useMemo(
    () =>
      new ReplayTimeline(adapter, project.commands, {
        seed: project.seed,
        checkpointEvery: project.checkpointEvery,
      }),
    [adapter, project.commands, project.seed, project.checkpointEvery],
  );
  const playback = useMemo(() => new Playback(timeline, { start: 0, end }), [timeline, end]);
  const lastT = useRef(0);
  useEffect(() => {
    playback.seek(lastT.current);
    return () => playback.destroy();
  }, [playback]);
  const story = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  lastT.current = story.t;

  /* Recording ------------------------------------------------------------------------ */

  const [recording, setRecording] = useState<LiveSession | null>(null);
  const [liveState, setLiveState] = useState<unknown>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [liveNow, setLiveNow] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const finishRecording = useCallback(
    (session: LiveSession) => {
      session.close();
      const last = session.log.at(-1)?.t ?? 0;
      lastT.current = last;
      setRecording(null);
      setStopping(false);
      setRejected(null);
      if (session.log.length > 0) {
        setHistory((h) => commit(h, appendCommands(h.present, session.log)));
      }
    },
    [],
  );

  // Stop can arrive while a scene is waiting for its fixture service. Closing now would
  // lose the outcome and leave a recording stuck in "Saving", so Stop waits for it.
  const stoppingRef = useRef(false);
  stoppingRef.current = stopping;

  const startRecording = () => {
    playback.pause();
    const state = timeline.stateAfter(timeline.length);
    const session: LiveSession = new LiveSession({
      adapter,
      host: browserHost,
      state,
      startT: project.commands.length === 0 ? 0 : projectEnd(project) + RECORDING_GAP_MS,
      startSeq: nextSeq(project),
      onChange: (next) => {
        setLiveState(next);
        setLiveCount(session.log.length);
        setRejected(null);
        if (stoppingRef.current && session.pendingOutcomes === 0) finishRecording(session);
      },
    });
    setLiveState(state);
    setLiveCount(0);
    setRecording(session);
    setSelection(null);
  };

  const stopRecording = () => {
    if (recording === null) return;
    if (recording.pendingOutcomes > 0) {
      setStopping(true);
      return;
    }
    finishRecording(recording);
  };

  useEffect(() => {
    if (recording === null) return;
    const timer = setInterval(() => setLiveNow(recording.t), 200);
    return () => clearInterval(timer);
  }, [recording]);

  const sendLive = useCallback(
    (type: string, payload?: Payload) => {
      if (recording === null) return;
      const result = recording.send(type, payload);
      if (!result.ok) setRejected(result.reason);
    },
    [recording],
  );

  /* Edits ---------------------------------------------------------------------------- */

  const applyTrackEdit = useCallback((next: ReelProject) => {
    setHistory((h) => commit(h, next));
  }, []);

  /** Commits a command edit, or opens the repair dialog if it breaks a later command. */
  const applyCommandEdit = (next: ReelProject) => {
    const proposal = proposeEdit(adapter, next);
    if (proposal.broken.length === 0) setHistory((h) => commit(h, next));
    else setRepair(proposal);
  };

  const removeCommand = (seq: number) => {
    applyCommandEdit(removeCommands(project, new Set([seq])));
    setSelection(null);
  };

  const addChapter = () => {
    const id = newTrackId(project, 'chapter');
    const chapter = { id, t: Math.round(story.t), title: `Chapter at ${formatTime(story.t)}` };
    applyTrackEdit({
      ...project,
      chapters: [...project.chapters, chapter].sort((a, b) => a.t - b.t),
    });
    setSelection({ kind: 'chapter', id });
  };

  const addCaption = () => {
    const id = newTrackId(project, 'caption');
    const start = Math.round(story.t);
    const caption = { id, start, end: start + 3000, text: 'New caption', target: null };
    applyTrackEdit({
      ...project,
      captions: [...project.captions, caption].sort((a, b) => a.start - b.start),
    });
    setSelection({ kind: 'caption', id });
  };

  const addShot = () => {
    const id = newTrackId(project, 'shot');
    const shot = { id, t: Math.round(story.t), target: null };
    applyTrackEdit({
      ...project,
      camera: [...project.camera, shot].sort((a, b) => a.t - b.t),
    });
    setSelection({ kind: 'shot', id });
  };

  const moveItem = (item: NonNullable<Selection>, t: number) => {
    if (item.kind === 'command') {
      applyCommandEdit(retimeCommand(project, item.seq, t));
    } else if (item.kind === 'chapter') {
      applyTrackEdit({
        ...project,
        chapters: project.chapters
          .map((c) => (c.id === item.id ? { ...c, t } : c))
          .sort((a, b) => a.t - b.t),
      });
    } else if (item.kind === 'caption') {
      applyTrackEdit({
        ...project,
        captions: project.captions
          .map((c) => (c.id === item.id ? { ...c, start: t, end: t + (c.end - c.start) } : c))
          .sort((a, b) => a.start - b.start),
      });
    } else {
      applyTrackEdit({
        ...project,
        camera: project.camera
          .map((c) => (c.id === item.id ? { ...c, t } : c))
          .sort((a, b) => a.t - b.t),
      });
    }
  };

  /* Saving --------------------------------------------------------------------------- */

  const saveNow = useCallback(async () => {
    if (drafts === null) {
      setSave({ kind: 'failed', message: 'Local storage is not available in this browser.' });
      return;
    }
    setSave({ kind: 'saving' });
    try {
      await drafts.save(project);
      setSave({ kind: 'saved', at: Date.now() });
    } catch (error) {
      setSave({ kind: 'failed', message: storageMessage(error) });
    }
  }, [drafts, project]);

  useEffect(() => {
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveNow]);

  const downloadProject = () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`);
    downloadBytes(bytes, `${project.id}.reel.json`, 'application/json');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === 'Escape') {
        setSelection(null);
      } else if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setHistory((h) => (event.shiftKey ? redo(h) : undo(h)));
      } else if (!command && event.key === ' ' && event.target === document.body && recording === null) {
        event.preventDefault();
        if (playback.getSnapshot().playing) playback.pause();
        else playback.play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback, recording, saveNow]);

  const isRecording = recording !== null;
  const shownState = isRecording ? liveState : story.state;
  const empty = project.commands.length === 0 && !isRecording;

  return (
    <main className="ed" data-recording={isRecording}>
      <header className="ed-top">
        <button type="button" className="ed-wordmark" onClick={onClose}>
          Reel
        </button>
        <h1 className="ed-title">{project.title}</h1>
        <span className="ed-scene">{adapter.title}</span>
        <span className="ed-spacer" />
        <SaveLabel status={save} />
        <button
          type="button"
          className="ed-icon"
          disabled={history.past.length === 0 || isRecording}
          onClick={() => setHistory(undo)}
        >
          Undo
        </button>
        <button
          type="button"
          className="ed-icon"
          disabled={history.future.length === 0 || isRecording}
          onClick={() => setHistory(redo)}
        >
          Redo
        </button>
        <button type="button" className="ed-icon" disabled={isRecording} onClick={() => void saveNow()}>
          Save
        </button>
        <button type="button" className="ed-primary" disabled={isRecording} onClick={() => setExporting(true)}>
          Export
        </button>
      </header>

      {notice !== null && (
        <p className="ed-notice" role="status">
          {notice}
        </p>
      )}

      {save.kind === 'failed' && (
        <p className="ed-banner" role="alert">
          {save.message} Your work is still open here.{' '}
          <button type="button" className="ed-text" onClick={downloadProject}>
            Download project file
          </button>
        </p>
      )}

      <p className="ed-narrow-note">
        Reel fits a wider screen better. Recording and editing still work here.
      </p>

      <div className="ed-main">
        <div className="ed-stagecol">
          <Stage
            adapter={adapter}
            state={shownState}
            interactive={isRecording}
            send={sendLive}
            cameraTarget={isRecording ? null : (shotAt(project.camera, story.t)?.target ?? null)}
            framing="follow"
            caption={isRecording ? null : captionAt(project.captions, story.t)}
            activeTarget={null}
            smooth={story.playing}
            label={isRecording ? 'Scene, recording' : 'Scene preview'}
          />

          {empty && (
            <p className="ed-empty">
              Press Record, then use the scene as a viewer would. Reel logs each command the scene
              declares. It does not record pixels or mouse positions.
            </p>
          )}
          {rejected !== null && (
            <p className="ed-problem" role="alert">
              {rejected}
            </p>
          )}

          <div className="ed-transport">
            {isRecording ? (
              <button type="button" className="ed-record" data-on="true" onClick={stopRecording} disabled={stopping}>
                {stopping ? 'Finishing' : 'Stop'}
              </button>
            ) : (
              <button type="button" className="ed-record" onClick={startRecording}>
                Record
              </button>
            )}
            {isRecording ? (
              <span className="ed-live" role="status">
                Recording at {formatTime(liveNow)}. {liveCount} {liveCount === 1 ? 'command' : 'commands'}.
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="reel-button-ghost"
                  disabled={project.commands.length === 0}
                  onClick={() => (story.playing ? playback.pause() : playback.play())}
                >
                  {story.playing ? 'Pause' : 'Play'}
                </button>
                <span className="reel-time">
                  {formatTime(story.t)} / {formatTime(end)}
                </span>
                <div className="ed-slider">
                  <TimelineBar
                    range={{ start: 0, end }}
                    t={story.t}
                    chapters={project.chapters}
                    onSeek={(t) => playback.seek(t)}
                    disabled={false}
                    fork={null}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <Inspector
          adapter={adapter}
          project={project}
          selection={selection}
          t={Math.round(story.t)}
          onChange={applyTrackEdit}
          onRetimeCommand={(seq, t) => applyCommandEdit(retimeCommand(project, seq, t))}
          onEditPayload={(seq, payload) => applyCommandEdit(setCommandPayload(project, seq, payload))}
          onRemoveCommand={removeCommand}
          onSelect={setSelection}
          onClearSelection={() => setSelection(null)}
        />
      </div>

      <div className="ed-tools">
        <span>Add at {formatTime(story.t)}:</span>
        <button type="button" className="ed-small" disabled={isRecording} onClick={addChapter}>
          Chapter
        </button>
        <button type="button" className="ed-small" disabled={isRecording} onClick={addCaption}>
          Caption
        </button>
        <button type="button" className="ed-small" disabled={isRecording} onClick={addShot}>
          Camera shot
        </button>
      </div>

      <Timeline
        project={project}
        end={end}
        t={story.t}
        selection={selection}
        onSelect={setSelection}
        onSeek={(t) => playback.seek(t)}
        onMove={moveItem}
      />

      {repair !== null && (
        <RepairDialog
          proposal={repair}
          onRepair={() => {
            const fixed = withoutBroken(adapter, repair);
            if (fixed.broken.length === 0) setHistory((h) => commit(h, fixed.project));
            setRepair(null);
          }}
          onCancel={() => setRepair(null)}
        />
      )}

      {exporting && (
        <ExportDialog
          adapter={adapter}
          project={project}
          onDownloadProject={downloadProject}
          onClose={() => setExporting(false)}
        />
      )}
    </main>
  );
}

function SaveLabel({ status }: { status: SaveStatus }) {
  const text =
    status.kind === 'saving'
      ? 'Saving'
      : status.kind === 'saved'
        ? `Saved ${new Date(status.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Not saved';
  return (
    <span className="ed-save" role="status" data-state={status.kind}>
      {text}
    </span>
  );
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
  }, []);
  return ref;
}

function RepairDialog({
  proposal,
  onRepair,
  onCancel,
}: {
  proposal: EditProposal;
  onRepair: () => void;
  onCancel: () => void;
}) {
  const ref = useModal();
  const count = proposal.broken.length;
  return (
    <dialog ref={ref} className="ed-dialog" onCancel={onCancel} aria-labelledby="repair-title">
      <h2 id="repair-title">This edit breaks {count === 1 ? '1 later command' : `${count} later commands`}</h2>
      <p>
        The commands below depend on what you changed, so they cannot play. Reel will not save a
        recording that cannot play.
      </p>
      <ul className="ed-broken">
        {proposal.broken.slice(0, 12).map((issue) => (
          <li key={issue.seq ?? issue.message}>{issue.message}</li>
        ))}
        {count > 12 && <li>And {count - 12} more.</li>}
      </ul>
      <div className="ed-dialog-actions">
        <button type="button" className="ed-icon" onClick={onCancel}>
          Cancel the edit
        </button>
        <button type="button" className="ed-primary" onClick={onRepair}>
          Remove {count === 1 ? 'that command too' : `those ${count} commands too`}
        </button>
      </div>
    </dialog>
  );
}

type ExportPhase =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number }
  | { kind: 'done'; bytes: number }
  | { kind: 'failed'; message: string };

function ExportDialog({
  adapter,
  project,
  onDownloadProject,
  onClose,
}: {
  adapter: AnyAdapter;
  project: ReelProject;
  onDownloadProject: () => void;
  onClose: () => void;
}) {
  const ref = useModal();
  const issues = useMemo(() => validateProject(adapter, project), [adapter, project]);
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const blocked = issues.length > 0 || project.commands.length === 0;

  const start = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ kind: 'working', done: 0, total: 1 });
    try {
      const zip = await exportZip(project, adapter, abort.signal, (done, total) =>
        setPhase({ kind: 'working', done, total }),
      );
      downloadBytes(zip, `${project.id}-viewer.zip`, 'application/zip');
      setPhase({ kind: 'done', bytes: zip.length });
    } catch (error) {
      setPhase({
        kind: 'failed',
        message: abort.signal.aborted
          ? 'Export cancelled. No file was created.'
          : `Export failed. No file was created. ${String((error as Error).message)}`,
      });
    }
  };

  const close = () => {
    controller.current?.abort();
    onClose();
  };

  return (
    <dialog ref={ref} className="ed-dialog" onCancel={close} aria-labelledby="export-title">
      <h2 id="export-title">Export</h2>
      {project.commands.length === 0 && <p>Record something first. There is nothing to export yet.</p>}
      {issues.length > 0 && (
        <>
          <p className="ed-problem">Fix these before exporting.</p>
          <ul className="ed-broken">
            {issues.slice(0, 8).map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
          </ul>
        </>
      )}
      <p>
        The viewer bundle is a folder of static files. It holds this story, the {adapter.title} scene
        and a plain transcript. Unzip it on any static host. It works under a nested path.
      </p>
      <p role="status" className="ed-export-status">
        {phase.kind === 'working' && `Collecting files: ${phase.done} of ${phase.total}.`}
        {phase.kind === 'done' && `Done. ${(phase.bytes / 1024).toFixed(0)} KB downloaded.`}
        {phase.kind === 'failed' && phase.message}
      </p>
      <div className="ed-dialog-actions">
        <button type="button" className="ed-icon" onClick={close}>
          {phase.kind === 'working' ? 'Cancel' : 'Close'}
        </button>
        <button type="button" className="ed-icon" onClick={onDownloadProject}>
          Download project file
        </button>
        <button
          type="button"
          className="ed-primary"
          disabled={blocked || phase.kind === 'working'}
          onClick={() => void start()}
        >
          Export viewer bundle
        </button>
      </div>
    </dialog>
  );
}
