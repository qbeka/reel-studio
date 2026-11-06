import { useEffect, useRef, useState } from 'react';
import type { AnyAdapter } from '../src/core/adapter';
import { newTrackId } from '../src/core/edit';
import type { ReelProject } from '../src/core/project';
import { captionAt } from '../src/core/tracks';
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
  const { command } = context;
  const [exportState, setExportState] = useState<ExportState>('idle');
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (project !== null) setExportState((state) => (state === 'saved' ? 'idle' : state));
  }, [project]);

  const t = command?.t ?? 0;
  const chapter = project.chapters.find((c) => c.t === t)?.title ?? '';
  const caption = captionAt(project.captions, t)?.text ?? '';
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
      <label>
        <span>Chapter title</span>
        <input
          key={`chapter-${t}`}
          value={chapter}
          maxLength={TITLE_LENGTH}
          disabled={command === null}
          placeholder="This step starts no chapter"
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
          placeholder="Nothing is said at this step"
          onChange={(event) => onChange(withCaption(adapter, project, context, event.target.value))}
        />
      </label>
      <div className="author-actions">
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
      </div>
      <p>Your changes stay in this page until you export a zip of the static viewer with them in it.</p>
      <div className="sr-only" role="status">
        {exportState === 'saved' ? `Saved ${project.id}.zip.` : ''}
        {exportState === 'failed' ? 'The export failed, so nothing was saved.' : ''}
      </div>
    </div>
  );
}
