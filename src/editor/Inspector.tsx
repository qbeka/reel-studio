import { useEffect, useState } from 'react';
import type { AnyAdapter, Payload } from '../core/adapter';
import { LIMITS, type ReelProject, formatTime } from '../core/project';
import type { Selection } from './Timeline';

/** Time in seconds as an editable field. Commits on blur or Enter, in whole milliseconds. */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (ms: number) => void;
}) {
  const [text, setText] = useState((value / 1000).toFixed(1));
  useEffect(() => setText((value / 1000).toFixed(1)), [value]);
  const commit = () => {
    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds * 1000 <= LIMITS.timeMs) {
      const ms = Math.round(seconds * 1000);
      if (ms !== value) onCommit(ms);
    } else {
      setText((value / 1000).toFixed(1));
    }
  };
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() === '') setText(value);
    else if (text !== value) onCommit(text.slice(0, LIMITS.textLength));
  };
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: both branches below render a control.
    <label className="ed-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          maxLength={LIMITS.textLength}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          maxLength={LIMITS.textLength}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      )}
    </label>
  );
}

function TargetField({
  adapter,
  value,
  onChange,
  emptyLabel,
}: {
  adapter: AnyAdapter;
  value: string | null;
  onChange: (target: string | null) => void;
  emptyLabel: string;
}) {
  return (
    <label className="ed-field">
      <span>Target</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {adapter.targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface InspectorProps {
  adapter: AnyAdapter;
  project: ReelProject;
  selection: Selection;
  t: number;
  onChange: (project: ReelProject) => void;
  onRetimeCommand: (seq: number, t: number) => void;
  onEditPayload: (seq: number, payload: Payload) => void;
  onRemoveCommand: (seq: number) => void;
  onSelect: (selection: Selection) => void;
  onClearSelection: () => void;
}

export function Inspector(props: InspectorProps) {
  const { adapter, project, selection, t, onChange, onClearSelection } = props;

  if (selection?.kind === 'command') {
    const entry = project.commands.find((c) => c.seq === selection.seq);
    if (entry !== undefined) return <CommandInspector {...props} seq={entry.seq} />;
  }

  if (selection?.kind === 'chapter') {
    const chapter = project.chapters.find((c) => c.id === selection.id);
    if (chapter !== undefined) {
      const update = (patch: Partial<typeof chapter>) =>
        onChange({
          ...project,
          chapters: project.chapters
            .map((c) => (c.id === chapter.id ? { ...c, ...patch } : c))
            .sort((a, b) => a.t - b.t),
        });
      return (
        <Panel title="Chapter" onBack={onClearSelection}>
          <TextField label="Title" value={chapter.title} onCommit={(title) => update({ title })} />
          <TimeField label="Starts at (seconds)" value={chapter.t} onCommit={(value) => update({ t: value })} />
          <Remove
            label="Delete chapter"
            onClick={() => {
              onChange({ ...project, chapters: project.chapters.filter((c) => c.id !== chapter.id) });
              onClearSelection();
            }}
          />
        </Panel>
      );
    }
  }

  if (selection?.kind === 'caption') {
    const caption = project.captions.find((c) => c.id === selection.id);
    if (caption !== undefined) {
      const update = (patch: Partial<typeof caption>) =>
        onChange({
          ...project,
          captions: project.captions
            .map((c) => (c.id === caption.id ? { ...c, ...patch } : c))
            .sort((a, b) => a.start - b.start),
        });
      return (
        <Panel title="Caption" onBack={onClearSelection}>
          <TextField label="Text" multiline value={caption.text} onCommit={(text) => update({ text })} />
          <TimeField
            label="Starts at (seconds)"
            value={caption.start}
            onCommit={(start) => {
              if (start < caption.end) update({ start });
            }}
          />
          <TimeField
            label="Ends at (seconds)"
            value={caption.end}
            onCommit={(end) => {
              if (end > caption.start) update({ end });
            }}
          />
          <TargetField
            adapter={adapter}
            value={caption.target}
            emptyLabel="None"
            onChange={(target) => update({ target })}
          />
          <p className="ed-hint">The caption moves to the edge that keeps this target visible.</p>
          <Remove
            label="Delete caption"
            onClick={() => {
              onChange({ ...project, captions: project.captions.filter((c) => c.id !== caption.id) });
              onClearSelection();
            }}
          />
        </Panel>
      );
    }
  }

  if (selection?.kind === 'shot') {
    const shot = project.camera.find((c) => c.id === selection.id);
    if (shot !== undefined) {
      const update = (patch: Partial<typeof shot>) =>
        onChange({
          ...project,
          camera: project.camera
            .map((c) => (c.id === shot.id ? { ...c, ...patch } : c))
            .sort((a, b) => a.t - b.t),
        });
      return (
        <Panel title="Camera shot" onBack={onClearSelection}>
          <TargetField
            adapter={adapter}
            value={shot.target}
            emptyLabel="Full scene"
            onChange={(target) => update({ target })}
          />
          <TimeField label="Starts at (seconds)" value={shot.t} onCommit={(value) => update({ t: value })} />
          <p className="ed-hint">
            Shots name a target, not pixels, so framing works in the wide and narrow layouts.
          </p>
          <Remove
            label="Delete shot"
            onClick={() => {
              onChange({ ...project, camera: project.camera.filter((c) => c.id !== shot.id) });
              onClearSelection();
            }}
          />
        </Panel>
      );
    }
  }

  return (
    <Panel title="Project">
      <TextField label="Title" value={project.title} onCommit={(title) => onChange({ ...project, title })} />
      <TextField
        label="Disclosure shown to viewers"
        multiline
        value={project.disclosure || 'Synthetic data.'}
        onCommit={(disclosure) => onChange({ ...project, disclosure })}
      />
      <div className="ed-field">
        <span>Trim</span>
        <div className="ed-row">
          <button
            type="button"
            className="ed-small"
            onClick={() => {
              const end = project.trim?.end ?? Number.MAX_SAFE_INTEGER;
              if (t < end) onChange({ ...project, trim: { start: t, end: project.trim?.end ?? projectTrimEnd(project, t) } });
            }}
          >
            Start at {formatTime(t)}
          </button>
          <button
            type="button"
            className="ed-small"
            onClick={() => {
              const start = project.trim?.start ?? 0;
              if (t > start) onChange({ ...project, trim: { start, end: t } });
            }}
          >
            End at {formatTime(t)}
          </button>
        </div>
        {project.trim !== null && (
          <p className="ed-hint">
            Viewers see {formatTime(project.trim.start)} to {formatTime(project.trim.end)}. Commands
            before the start still run, so the state stays correct.{' '}
            <button type="button" className="ed-text" onClick={() => onChange({ ...project, trim: null })}>
              Clear trim
            </button>
          </p>
        )}
      </div>
      <div className="ed-field">
        <span>Poster</span>
        <button
          type="button"
          className="ed-small"
          onClick={() => onChange({ ...project, posterT: Math.round(t) })}
        >
          Use {formatTime(t)} as the poster
        </button>
        <p className="ed-hint">Now set to {formatTime(project.posterT)}.</p>
      </div>
    </Panel>
  );
}

function projectTrimEnd(project: ReelProject, t: number): number {
  return Math.max(t + 1, project.commands.at(-1)?.t ?? 0);
}

function CommandInspector({
  adapter,
  project,
  seq,
  onRetimeCommand,
  onEditPayload,
  onRemoveCommand,
  onSelect,
  onClearSelection,
}: InspectorProps & { seq: number }) {
  const index = project.commands.findIndex((c) => c.seq === seq);
  const entry = project.commands[index]!;
  const previous = project.commands[index - 1];
  const next = project.commands[index + 1];
  const shown = JSON.stringify(entry.payload, null, 2);
  const [text, setText] = useState(shown);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setText(shown);
    setProblem(null);
  }, [shown]);

  const commitPayload = () => {
    if (text === shown) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setProblem('This is not valid JSON.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setProblem('The payload must be an object.');
      return;
    }
    const reason = adapter.parse(entry.type, parsed as Payload);
    if (reason !== null) {
      setProblem(reason);
      return;
    }
    setProblem(null);
    onEditPayload(entry.seq, parsed as Payload);
  };

  return (
    <Panel title="Command" onBack={onClearSelection}>
      <div className="ed-row">
        <button
          type="button"
          className="ed-small"
          disabled={previous === undefined}
          onClick={() => onSelect({ kind: 'command', seq: previous!.seq })}
        >
          Previous
        </button>
        <button
          type="button"
          className="ed-small"
          disabled={next === undefined}
          onClick={() => onSelect({ kind: 'command', seq: next!.seq })}
        >
          Next
        </button>
        <span className="ed-hint">
          {index + 1} of {project.commands.length}
        </span>
      </div>
      <dl className="ed-facts">
        <dt>Type</dt>
        <dd>{entry.type}</dd>
        <dt>Source</dt>
        <dd>{entry.source === 'user' ? 'Recorded input' : 'Recorded outcome'}</dd>
      </dl>
      <TimeField key={entry.seq} label="Time (seconds)" value={entry.t} onCommit={(t) => onRetimeCommand(entry.seq, t)} />
      <label className="ed-field">
        <span>Payload</span>
        <textarea
          className="ed-code"
          rows={6}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitPayload}
        />
      </label>
      {problem !== null && (
        <p className="ed-problem" role="alert">
          {problem}
        </p>
      )}
      <Remove label="Delete command" onClick={() => onRemoveCommand(entry.seq)} />
    </Panel>
  );
}

function Panel({
  title,
  onBack,
  children,
}: {
  title: string;
  /** Returns to the project settings. Absent on that panel itself. */
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="ed-inspector" aria-label={title}>
      <div className="ed-panel-head">
        <h2>{title}</h2>
        {onBack !== undefined && (
          <button type="button" className="ed-text" onClick={onBack}>
            Project settings
          </button>
        )}
      </div>
      {children}
    </aside>
  );
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ed-text ed-remove" onClick={onClick}>
      {label}
    </button>
  );
}
