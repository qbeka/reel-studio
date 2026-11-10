import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnyAdapter, LogEntry } from '../src/core/adapter';
import { type Branch, openBranch } from '../src/core/branch';
import { type ReelProject, formatTime, parseProject, playRange } from '../src/core/project';
import { browserHost } from '../src/core/session';
import { hashJson } from '../src/core/sha256';
import { Timeline } from '../src/core/timeline';
import { chapterIndexAt } from '../src/core/tracks';
import { Mini } from '../src/player/Mini';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import recording from '../projects/receipt-split-release.reel.json';
import type { SiteClaims } from '../scripts/site-data';
import data from './data/claims.json';

const claims = data as SiteClaims;
const adapter = receiptAdapter as AnyAdapter;
const parsed = parseProject(recording);
if (!parsed.ok) throw new Error(parsed.errors.join(' '));
const project: ReelProject = parsed.project;
const range = playRange(project);
const timeline = new Timeline(adapter, project.commands, { seed: project.seed, checkpointEvery: project.checkpointEvery });

/** What a video of this recording would hold. It is arithmetic, and the figure says so. */
const FPS = 30;
const FRAMES = Math.round(((range.end - range.start) / 1000) * FPS);

const ms = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US'));

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function CopyButton({ text, label = 'Copy' }: { text: () => string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      className="control outline copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setState('done');
        } catch {
          setState('failed');
        }
      }}
    >
      <span data-on={state === 'idle'}>{label}</span>
      <span data-on={state === 'done'}>Copied</span>
      <span data-on={state === 'failed'}>Select it instead</span>
      <span className="sr-only" role="status">
        {state === 'done' ? 'Copied' : ''}
      </span>
    </button>
  );
}

/* Frames against commands -------------------------------------------------------------- */

const PAD = 10;

function LogFigure() {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [t, setT] = useState(project.commands[5]!.t + 600);
  const usable = Math.max(0, width - PAD * 2);
  const x = (time: number) => PAD + ((time - range.start) / (range.end - range.start)) * usable;
  const count = timeline.countAt(t);
  const state = useMemo(() => timeline.stateAfter(count), [count]);
  const last: LogEntry | undefined = project.commands[count - 1];
  const frame = Math.min(FRAMES, Math.floor(((t - range.start) / 1000) * FPS) + 1);
  const [miniRef, miniWidth] = useWidth<HTMLDivElement>();

  const frames = useMemo(() => {
    let d = '';
    for (let i = 0; i < FRAMES; i++) {
      const at = PAD + (i / FRAMES) * usable;
      d += `M${at.toFixed(2)} 4v22`;
    }
    return d;
  }, [usable]);

  const chapter = chapterIndexAt(project.chapters, t);

  return (
    <>
      <div className="lanes" ref={ref}>
        <div className="lane">
          <p>
            <b>A video</b> at {FPS} frames a second
            <i>{FRAMES} pictures</i>
          </p>
          <svg width={width} height={30} aria-hidden="true">
            <path className="lane-frames" d={frames} />
            <clipPath id="lane-past">
              <rect x={0} y={0} width={x(t)} height={30} />
            </clipPath>
            <path className="lane-frames" data-past="true" d={frames} clipPath="url(#lane-past)" />
          </svg>
        </div>
        <div className="lane">
          <p>
            <b>Reel's recording</b> of the same {formatTime(range.end)}
            <i>{project.commands.length} commands</i>
          </p>
          <svg width={width} height={58} aria-hidden="true">
            <line className="lane-rule" x1={PAD} x2={width - PAD} y1={14} y2={14} />
            {project.commands.map((command, i) => {
              const passed = command.t <= t;
              return (
                <g key={command.seq} className="lane-command" data-past={passed} data-made={command.source === 'user'} data-now={i === count - 1}>
                  <circle cx={x(command.t)} cy={14} r={command.source === 'user' ? 5 : 4} />
                  <line x1={x(command.t)} x2={x(command.t)} y1={22} y2={i % 2 === 0 ? 30 : 44} />
                  <text x={x(command.t)} y={i % 2 === 0 ? 41 : 55} textAnchor={x(command.t) > width - 70 ? 'end' : 'middle'}>
                    {command.type}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {width > 0 && (
          <span className="lanes-cursor" style={{ left: x(t) }} aria-hidden="true">
            <i>{formatTime(t)}</i>
          </span>
        )}
        <input
          type="range"
          className="lanes-slider"
          aria-label="Moment in the recording"
          aria-valuetext={`${formatTime(t)}, frame ${frame} of ${FRAMES}, command ${count} of ${project.commands.length}`}
          min={range.start}
          max={range.end}
          step={50}
          value={t}
          onChange={(event) => setT(Number(event.target.value))}
        />
      </div>

      <div className="log-read">
        <div className="log-card" data-kind="video">
          <p className="log-kind">The video has</p>
          <p className="log-big">
            Frame <b>{frame}</b> of {FRAMES}
          </p>
          <div className="log-frame" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p className="log-note">A picture of the screen, kept whether or not anything changed since the last one</p>
        </div>
        <div className="log-card" data-kind="reel">
          <p className="log-kind">The recording has</p>
          <p className="log-big">
            Command <b>{count}</b> of {project.commands.length}
          </p>
          <pre className="log-code">
            <code>
              {last === undefined
                ? 'Nothing yet, so the app is in the state it starts in'
                : JSON.stringify({ t: last.t, type: last.type, payload: last.payload, source: last.source }, null, 1)
                    .replace(/\n\s*/g, ' ')}
            </code>
          </pre>
          <p className="log-note">
            {chapter >= 0 ? `In the chapter ${project.chapters[chapter]!.title}` : 'Before the first chapter'}, and the app
            shown with this is drawn from the state after that command
          </p>
        </div>
        <div className="log-mini" ref={miniRef}>
          {miniWidth > 0 && <Mini adapter={adapter} state={state} width={miniWidth} sceneHeight={500} />}
        </div>
      </div>
    </>
  );
}

/* The seek benchmark -------------------------------------------------------------------- */

interface Bar {
  name: string;
  note: string;
  median: number;
  min: number;
  max: number;
  runs: readonly number[];
  kind: 'reel' | 'base';
}

function Bars({ title, scope, bars, top, log, verdict }: { title: string; scope: string; bars: readonly Bar[]; top: number; log: boolean; verdict: string }) {
  const low = 1;
  const at = (value: number) =>
    log
      ? (Math.log10(Math.max(low, value)) - Math.log10(low)) / (Math.log10(top) - Math.log10(low))
      : value / top;
  const ticks = log ? [1, 10, 100, 1000].filter((v) => v <= top) : [0, top / 4, top / 2, (top * 3) / 4, top];
  return (
    <div className="bars">
      <header>
        <h4>{title}</h4>
        <p>{scope}</p>
      </header>
      <div className="bars-plot">
        <ol className="bars-ticks" aria-hidden="true">
          {ticks.map((tick) => (
            <li key={tick} style={{ left: `${at(tick) * 100}%` }}>
              {Math.round(tick).toLocaleString('en-US')}
              {tick === ticks.at(-1) && ' ms'}
            </li>
          ))}
        </ol>
        {bars.map((bar) => (
          <div className="bar" key={bar.name} data-kind={bar.kind}>
            <p>
              <b>{bar.name}</b>
              <span>{bar.note}</span>
            </p>
            <div className="bar-track">
              <span className="bar-fill" style={{ width: `${at(bar.median) * 100}%` }} />
              <span
                className="bar-range"
                style={{ left: `${at(bar.min) * 100}%`, width: `${(at(bar.max) - at(bar.min)) * 100}%` }}
                title={`Range ${ms(bar.min)} to ${ms(bar.max)} ms across 5 runs`}
              />
              {bar.runs.map((run, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: runs are a fixed list, in the order they were made.
                <i key={i} className="bar-run" style={{ left: `${at(run) * 100}%` }} title={`Run ${i + 1}: ${ms(run)} ms`} />
              ))}
            </div>
            <output>
              <b>{ms(bar.median)} ms</b>
              <span>
                {ms(bar.min)} to {ms(bar.max)}
              </span>
            </output>
          </div>
        ))}
      </div>
      <p className="bars-verdict">{verdict}</p>
    </div>
  );
}

function SeekFigure() {
  const [log, setLog] = useState(false);
  const { stress, short } = claims.seek;
  const times = Math.round(stress.baseline.median / stress.checkpointed.median);
  const bar = (name: string, note: string, kind: Bar['kind'], a: SiteClaims['seek']['stress']['checkpointed']): Bar => ({
    name,
    note,
    kind,
    median: a.median,
    min: a.min,
    max: a.max,
    runs: a.perRun,
  });
  return (
    <>
      <div className="fig-tools">
        <fieldset className="seg">
          <legend className="sr-only">Scale</legend>
          {[
            [false, 'Each on its own scale'],
            [true, 'Both on one log scale'],
          ].map(([value, label]) => (
            <label key={String(value)} data-active={log === value}>
              <input type="radio" name="seek-scale" checked={log === value} onChange={() => setLog(value as boolean)} />
              {label as string}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="bars-pair">
        <Bars
          title={`A generated log of ${stress.commands.toLocaleString('en-US')} commands`}
          scope="A stress case made by a script, far longer than any demo"
          log={log}
          top={log ? 2000 : 1800}
          bars={[
            bar('From the nearest checkpoint', 'Reel', 'reel', stress.checkpointed),
            bar('Replay from the start', 'The same viewer with checkpoints off', 'base', stress.baseline),
          ]}
          verdict={`About ${times} times less waiting, on this log only`}
        />
        <Bars
          title={`The real recording on this page, ${short.commands} commands`}
          scope="Recorded through the editor, and what a viewer actually watches"
          log={log}
          top={log ? 2000 : 8}
          bars={[
            bar('From the nearest checkpoint', 'Reel', 'reel', short.checkpointed),
            bar('Replay from the start', 'The same viewer with checkpoints off', 'base', short.baseline),
          ]}
          verdict="No gain, because ten commands replay faster than anyone can notice, and the two bars differ by less than their own spread"
        />
      </div>
    </>
  );
}

/* How Take over forks state ------------------------------------------------------------- */

const short = (hash: string) => `${hash.slice(0, 6)} ${hash.slice(6, 12)}`;

interface CopyLine {
  text: string;
  made: boolean;
}

function ForkFigure() {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [t, setT] = useState(project.commands[5]!.t + 1000);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [copyState, setCopyState] = useState<unknown>(null);
  const [lines, setLines] = useState<readonly CopyLine[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [miniRef, miniWidth] = useWidth<HTMLDivElement>();
  const live = useRef<Branch | null>(null);
  useEffect(() => () => live.current?.session.close(), []);

  const usable = Math.max(0, width - PAD * 2);
  const x = (time: number) => PAD + ((time - range.start) / (range.end - range.start)) * usable;
  const count = timeline.countAt(t);
  const story = useMemo(() => timeline.stateAfter(count), [count]);
  const storyHash = useMemo(() => hashJson(adapter.serialize(story)), [story]);
  // Worked out again on every draw, from the recording itself, so it would show a change.
  const finalHash = hashJson(adapter.serialize(timeline.stateAfter(timeline.length)));
  const copyHash = branch === null || copyState === null ? null : hashJson(adapter.serialize(copyState));

  const fork = () => {
    live.current?.session.close();
    let before: unknown = story;
    const made: Branch = openBranch(adapter, story, t, browserHost, (next) => {
      const entry = made.session.log.at(-1)!;
      const text = adapter.describe(before, entry, next) ?? entry.type;
      before = next;
      setCopyState(next);
      setLines((shown) => [...shown, { text, made: entry.source === 'user' }]);
    });
    live.current = made;
    setBranch(made);
    setCopyState(made.session.state);
    setLines([]);
    setRefused(null);
  };
  const drop = () => {
    live.current?.session.close();
    live.current = null;
    setBranch(null);
    setCopyState(null);
    setLines([]);
    setRefused(null);
  };
  const send = (type: string, payload: LogEntry['payload'] = {}) => {
    if (branch === null) return;
    const result = branch.session.send(type, payload);
    setRefused(result.ok ? null : result.reason);
  };

  const same = copyHash !== null && copyHash === storyHash;
  const forkX = x(branch?.base.t ?? t);
  const view = (copyState as { view?: string } | null)?.view;

  return (
    <div className="fork">
      <div className="fork-lines" ref={ref} data-forked={branch !== null}>
        <svg width={width} height={96} aria-hidden="true">
          <line className="fork-rule" x1={PAD} x2={width - PAD} y1={22} y2={22} />
          {project.commands.map((command) => (
            <circle
              key={command.seq}
              className="fork-dot"
              data-made={command.source === 'user'}
              data-past={command.t <= (branch?.base.t ?? t)}
              cx={x(command.t)}
              cy={22}
              r={command.source === 'user' ? 4.5 : 3.5}
            />
          ))}
          {width > 0 && branch !== null && (
            <g className="fork-copy">
              <path d={`M ${forkX} 22 C ${forkX + 18} 22, ${forkX + 18} 66, ${forkX + 36} 66 L ${Math.min(width - PAD, forkX + 62 + lines.length * 22)} 66`} />
              {lines.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the copy's log only grows.
                <circle key={i} data-made={line.made} cx={Math.min(width - PAD - 8, forkX + 54 + i * 22)} cy={66} r={line.made ? 4.5 : 3.5} />
              ))}
            </g>
          )}
          {width > 0 && (
            <g className="fork-at" transform={`translate(${forkX} 22)`}>
              <circle r={8} />
              <circle r={3} />
            </g>
          )}
        </svg>
        <p className="fork-name" style={{ top: 0 }}>
          The recording <i>{project.commands.length} commands, read only</i>
        </p>
        {branch !== null && (
          <p className="fork-name fork-name-copy" style={{ top: 76 }}>
            Your copy <i>{lines.length === 0 ? 'an empty log of its own' : `${lines.length} in its own log`}</i>
          </p>
        )}
        <input
          type="range"
          className="lanes-slider fork-slider"
          aria-label="Moment to copy"
          aria-valuetext={formatTime(t)}
          min={range.start}
          max={range.end}
          step={50}
          value={branch?.base.t ?? t}
          disabled={branch !== null}
          onChange={(event) => setT(Number(event.target.value))}
        />
      </div>

      <div className="fork-body">
        <div className="fork-steps">
          <ol>
            <li data-on="true">
              <b>Pick a moment</b>
              <span>
                {formatTime(branch?.base.t ?? t)}, after {timeline.countAt(branch?.base.t ?? t)} of {project.commands.length} commands
              </span>
              <code title="First 12 characters of the SHA-256 of this state">{short(storyHash)}</code>
            </li>
            <li data-on={branch !== null}>
              <b>Copy its state</b>
              <span>Written out as data and read back in, so the copy shares nothing with it</span>
              {copyHash !== null && (
                <code data-same={same} title="First 12 characters of the SHA-256 of your copy">
                  {short(copyHash)}
                </code>
              )}
            </li>
            <li data-on={lines.length > 0}>
              <b>Change the copy</b>
              <span>
                {lines.length === 0
                  ? 'Its commands go to its own log'
                  : same
                    ? 'The copy has come back to the same state as the recording'
                    : 'The copy is now a different state, and the recording is not'}
              </span>
            </li>
          </ol>

          <div className="fork-actions">
            {branch === null ? (
              <button type="button" className="control primary" onClick={fork}>
                Copy the moment at {formatTime(t)}
              </button>
            ) : (
              <>
                <button type="button" className="control outline" onClick={() => send('addReceipt')}>
                  Add a receipt
                </button>
                <button
                  type="button"
                  className="control outline"
                  onClick={() => send('setView', { view: view === 'balances' ? 'receipt' : 'balances' })}
                >
                  {view === 'balances' ? 'Show the receipt' : 'Show balances'}
                </button>
                <button type="button" className="control" onClick={drop}>
                  Start again
                </button>
              </>
            )}
          </div>
          <p className="fork-said" role="status">
            {refused !== null
              ? `The app refused that: ${refused.replace(/\.$/, '')}`
              : lines.length > 0
                ? lines.at(-1)!.text
                : branch === null
                  ? 'Drag the ring along the recording, then copy that moment'
                  : 'The copy matches the recording exactly, so nothing has been lost or added'}
          </p>
          <p className="fork-proof">
            <span>The whole recording still ends in the state</span>
            <code>{short(finalHash)}</code>
          </p>
        </div>
        <div className="fork-mini" ref={miniRef}>
          {miniWidth > 0 && (
            <Mini adapter={adapter} state={copyState ?? story} width={miniWidth} sceneHeight={500} />
          )}
          <p>{branch === null ? `The recording at ${formatTime(t)}` : 'Your copy, running'}</p>
        </div>
      </div>
    </div>
  );
}

/* Seeded failures ----------------------------------------------------------------------- */

function ControlsFigure() {
  const { controls } = claims.correctness;
  const [open, setOpen] = useState(controls.findIndex((c) => c.blind));
  const shown = controls[open]!;
  return (
    <div className="seeded">
      <fieldset className="seeded-grid">
        <legend className="sr-only">Seeded failures</legend>
        {controls.map((control, i) => (
          <button
            key={control.id}
            type="button"
            className="seeded-cell"
            data-blind={control.blind}
            aria-pressed={i === open}
            aria-label={`${control.description.replace(/\.$/, '')}, caught by the ${CAUGHT_BY[control.detectedBy] ?? control.detectedBy}`}
            onClick={() => setOpen(i)}
            onMouseEnter={() => setOpen(i)}
            onFocus={() => setOpen(i)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M3.5 8.300l3 3 6-6.600" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </fieldset>
      <div className="seeded-said">
        <p>{shown.description.replace(/\.$/, '')}</p>
        <p>
          Caught by the {CAUGHT_BY[shown.detectedBy] ?? shown.detectedBy}
          {shown.blind && ', and invisible to the comparison with a replay'}
        </p>
      </div>
      <p className="seeded-key">
        <span data-blind="true">Reducer bugs, which only the separate model of the money caught</span>
        <span data-blind="false">Caught by comparing a seek with a replay, or by a check of their own</span>
      </p>
    </div>
  );
}

/* Embed --------------------------------------------------------------------------------- */

interface Manifest {
  title: string;
  commandCount: number;
  files: { path: string; bytes: number }[];
}

/** Who caught a seeded bug, in the words the page uses for that check. */
const CAUGHT_BY: Record<string, string> = {
  oracle: 'separate model of the money',
  'seek check': 'comparison of a seek with a replay',
  'latest-wins check': 'check that the newest seek wins',
  'round trip check': 'check that a state survives being written out and read back',
};

const kb = (bytes: number) => (bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`);

function snippetFor(title: string): string {
  return [
    '<iframe',
    `  title="${title}, interactive demo"`,
    '  src="/your-folder/embed.html"',
    '  loading="lazy"',
    '  style="width: 100%; max-width: 980px; aspect-ratio: 880 / 700; border: 0"',
    '></iframe>',
  ].join('\n');
}

function EmbedBlock({ folder }: { folder: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'working' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    let live = true;
    setManifest(null);
    setFailed(false);
    fetch(`${folder}bundle-manifest.json`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json: Manifest) => {
        if (live) setManifest(json);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [folder]);

  const title = manifest?.title ?? project.title;
  const snippet = snippetFor(title);
  const groups = useMemo(() => {
    if (manifest === null) return [];
    const total = (match: (path: string) => boolean) =>
      manifest.files.filter((f) => match(f.path)).reduce((n, f) => n + f.bytes, 0);
    const one = (path: string) => manifest.files.find((f) => f.path === path)?.bytes ?? 0;
    return [
      { name: 'embed.html', bytes: one('embed.html'), note: 'The poster your iframe loads, with no script in it' },
      { name: 'index.html', bytes: one('index.html'), note: 'The viewer, which the poster links to' },
      { name: 'project.reel.json', bytes: one('project.reel.json'), note: `The recording, ${manifest.commandCount} commands` },
      { name: 'transcript.html', bytes: one('transcript.html'), note: 'The same story as plain text' },
      { name: 'assets/*.js, *.css', bytes: total((p) => /\.(js|css)$/.test(p)), note: 'The player and both scenes, before compression' },
      { name: 'assets/*.woff2', bytes: total((p) => p.endsWith('.woff2')), note: 'Three font files' },
    ];
  }, [manifest]);

  const download = async () => {
    if (saving === 'working') return;
    setSaving('working');
    try {
      const [{ exportZip, downloadBytes }, scene] = await Promise.all([
        import('../src/export/browser'),
        folder === 'demo/' ? Promise.resolve({ adapter, project }) : loadRetries(),
      ]);
      const bytes = await exportZip(scene.project, scene.adapter, new AbortController().signal, () => {});
      downloadBytes(bytes, `${scene.project.id}.zip`, 'application/zip');
      setSaving('saved');
    } catch {
      setSaving('failed');
    }
  };

  return (
    <div className="embed">
      <div className="embed-code">
        <pre>
          <code>{snippet}</code>
        </pre>
        <div className="embed-actions">
          <CopyButton text={() => snippet} label="Copy the snippet" />
          <button type="button" className="control outline copy" aria-busy={saving === 'working'} onClick={download}>
            <span data-on={saving === 'idle'}>Download the folder as a zip</span>
            <span data-on={saving === 'working'}>Building it here</span>
            <span data-on={saving === 'saved'}>Saved</span>
            <span data-on={saving === 'failed'}>Try again</span>
          </button>
        </div>
        <p className="embed-note">
          Put the folder on any static host and change the address to match, because this site does not allow its own
          pages in frames and the snippet has to point at your copy
        </p>
      </div>
      <div className="embed-files">
        <p className="embed-head">
          What the export of this demo contains
          <i>{manifest === null ? '' : kb(manifest.files.reduce((n, f) => n + f.bytes, 0))}</i>
        </p>
        {failed ? (
          <p className="embed-note">The list could not be read just now, and the export itself is unaffected</p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.name}>
                <code>{group.name}</code>
                <span>{group.note}</span>
                <b>{kb(group.bytes)}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="embed-note">Read from the manifest of the exported viewer this page links to</p>
      </div>
    </div>
  );
}

async function loadRetries(): Promise<{ adapter: AnyAdapter; project: ReelProject }> {
  const [{ retryAdapter }, file] = await Promise.all([
    import('../src/scenes/retry-queue/adapter'),
    import('../projects/retry-queue.reel.json'),
  ]);
  const result = parseProject(file.default);
  if (!result.ok) throw new Error(result.errors.join(' '));
  return { adapter: retryAdapter as AnyAdapter, project: result.project };
}

function Embed() {
  const [folder, setFolder] = useState(document.documentElement.dataset.demo === 'retries' ? 'demo-retries/' : 'demo/');
  useEffect(() => {
    const onDemo = (event: Event) => setFolder((event as CustomEvent<string>).detail === 'retries' ? 'demo-retries/' : 'demo/');
    window.addEventListener('reel:demo', onDemo);
    return () => window.removeEventListener('reel:demo', onDemo);
  }, []);
  return <EmbedBlock folder={folder} />;
}

/* ---------------------------------------------------------------------------------------- */

const FIGURES: Record<string, () => ReactNode> = {
  'fig-log': () => <LogFigure />,
  'fig-seek': () => <SeekFigure />,
  'fig-fork': () => <ForkFigure />,
  'fig-seeded': () => <ControlsFigure />,
  'fig-embed': () => <Embed />,
};

/**
 * Replaces each figure's plain fallback with the live one. They go in one at a time, each
 * in a turn of its own, so that drawing them never holds the page for long.
 */
export function mountFigures(): void {
  const waiting = Object.entries(FIGURES);
  const next = () => {
    const entry = waiting.shift();
    if (entry === undefined) return;
    const [id, render] = entry;
    const host = document.getElementById(id);
    if (host !== null) {
      host.replaceChildren();
      host.dataset.live = 'true';
      createRoot(host).render(render());
    }
    setTimeout(next, 0);
  };
  next();
}
