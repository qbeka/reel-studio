import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnyAdapter } from '../src/core/adapter';
import { newTrackId } from '../src/core/edit';
import { type ReelProject, formatTime } from '../src/core/project';
import { captionAt, shotAt } from '../src/core/tracks';
import type { AuthorContext } from '../src/player/Viewer';

/** A caption with no later caption to stop at runs this long. */
const CAPTION_MS = 3000;
const TITLE_LENGTH = 60;
const CAPTION_LENGTH = 110;

function withChapter(project: ReelProject, t: number, title: string): ReelProject {
  const others = project.chapters.filter((c) => c.t !== t);
  if (title.trim() === '') return { ...project, chapters: others };
  const id = project.chapters.find((c) => c.t === t)?.id ?? newTrackId(project, 'chapter');
  return { ...project, chapters: [...others, { id, t, title }].sort((a, b) => a.t - b.t) };
}

function withCaption(
  adapter: AnyAdapter,
  project: ReelProject,
  context: AuthorContext,
  text: string,
): ReelProject {
  const { command, range } = context;
  if (command === null) return project;
  const found = captionAt(project.captions, command.t);
  if (text.trim() === '') {
    return { ...project, captions: project.captions.filter((c) => c.id !== found?.id) };
  }
  if (found !== null) {
    return {
      ...project,
      captions: project.captions.map((c) => (c.id === found.id ? { ...c, text } : c)),
    };
  }
  const next = project.captions.find((c) => c.start > command.t)?.start ?? range.end;
  const caption = {
    id: newTrackId(project, 'caption'),
    start: command.t,
    end: Math.min(next, command.t + CAPTION_MS),
    text,
    target: adapter.targetOf(command),
  };
  return {
    ...project,
    captions: [...project.captions, caption].sort((a, b) => a.start - b.start),
  };
}

/**
 * Frames `target` from `t` on. A shot that repeats the one before it says nothing, so it
 * is dropped, and so is a later shot that this change has made a repeat.
 */
function withShot(project: ReelProject, t: number, target: string | null): ReelProject {
  const others = project.camera.filter((shot) => shot.t !== t);
  const id = project.camera.find((shot) => shot.t === t)?.id ?? newTrackId(project, 'shot');
  const sorted = [...others, { id, t, target }].sort((a, b) => a.t - b.t);
  const camera = sorted.filter((shot, i) => shot.target !== (i === 0 ? null : sorted[i - 1]!.target));
  return { ...project, camera };
}

type ExportState = 'idle' | 'working' | 'saved' | 'failed';

export function Author({
  adapter,
  original,
  project,
  onChange,
  context,
}: {
  adapter: AnyAdapter;
  original: ReelProject;
  project: ReelProject;
  onChange: (project: ReelProject) => void;
  context: AuthorContext;
}) {
  const { command, steps, current, seek, close } = context;
  const [exportState, setExportState] = useState<ExportState>('idle');
  const running = useRef<AbortController | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (project !== null) setExportState((state) => (state === 'saved' ? 'idle' : state));
  }, [project]);

  // Moves only this list. `scrollIntoView` would also move the page.
  useLayoutEffect(() => {
    const box = list.current!;
    const item = box.querySelector<HTMLElement>('[aria-current="step"]');
    if (item === null) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  });

  const t = command?.t ?? 0;
  const chapter = project.chapters.find((c) => c.t === t)?.title ?? '';
  const caption = captionAt(project.captions, t)?.text ?? '';
  const framed = shotAt(project.camera, t)?.target ?? null;
  const changed = project !== original;

  const save = async () => {
    if (exportState === 'working') return;
    setExportState('working');
    const controller = new AbortController();
    running.current = controller;
    try {
      // The exporter brings a server renderer with it, so it loads only when asked for.
      const { exportZip, downloadBytes } = await import('../src/export/browser');
      const bytes = await exportZip(project, adapter, controller.signal, () => {});
      downloadBytes(bytes, `${project.id}.zip`, 'application/zip');
      setExportState('saved');
    } catch {
      if (!controller.signal.aborted) setExportState('failed');
    }
  };

  return (
    <div className="author">
      <header className="author-head">
        <h2>Authoring</h2>
        <button type="button" className="control" onClick={close}>
          Done
        </button>
      </header>

      <ol className="author-steps" ref={list} aria-label="Recorded commands">
        {steps.map((step, index) => (
          <li key={step.t}>
            <button
              type="button"
              className="author-step"
              aria-current={index === current ? 'step' : undefined}
              data-chapter={step.chapter}
              title={step.text}
              onClick={() => seek(step.t)}
            >
              <time>{formatTime(step.t)}</time>
              <span>{step.text}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="author-fields">
        <label>
          <span>Chapter that starts at this command</span>
          <input
            key={`chapter-${t}`}
            value={chapter}
            maxLength={TITLE_LENGTH}
            disabled={command === null}
            placeholder="None starts here"
            onChange={(event) => onChange(withChapter(project, t, event.target.value))}
          />
        </label>
        <label>
          <span>Caption</span>
          <textarea
            key={`caption-${t}`}
            value={caption}
            rows={2}
            maxLength={CAPTION_LENGTH}
            disabled={command === null}
            placeholder="Nothing is said here"
            onChange={(event) => onChange(withCaption(adapter, project, context, event.target.value))}
          />
        </label>
        <label>
          <span>Camera from this command on</span>
          <span className="author-select">
            <select
              value={framed ?? ''}
              disabled={command === null}
              onChange={(event) => onChange(withShot(project, t, event.target.value || null))}
            >
              <option value="">The whole app</option>
              {adapter.targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <footer className="author-actions">
        <button
          type="button"
          className="control primary"
          aria-busy={exportState === 'working'}
          onClick={save}
        >
          <span data-on={exportState === 'idle'}>Export</span>
          <span data-on={exportState === 'working'}>Exporting</span>
          <span data-on={exportState === 'saved'}>Saved</span>
          <span data-on={exportState === 'failed'}>Try again</span>
        </button>
        <button
          type="button"
          className="control"
          aria-disabled={!changed}
          onClick={() => {
            if (changed) onChange(original);
          }}
        >
          Reset
        </button>
        <p>Under the timeline the grey bars are captions and the green bar is a close camera, and Export saves a zip of the viewer with your changes</p>
      </footer>
      <div className="sr-only" role="status">
        {exportState === 'saved' ? `Saved ${project.id}.zip` : ''}
        {exportState === 'failed' ? 'The export failed, so nothing was saved' : ''}
      </div>
    </div>
  );
}
