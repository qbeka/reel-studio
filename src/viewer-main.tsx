import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseProject, validateCommandShapes, validateTracks } from './core/project';
import { resolveScene } from './core/registry';
import { type TranscriptLine, parseTranscript } from './core/transcript';
import { Viewer } from './player/Viewer';
import { SCENES } from './scenes/registry';
import './styles/foundation.css';
import './styles/player.css';
import './styles/scenes.css';

const root = createRoot(document.getElementById('root')!);

function showProblem(title: string, message: string) {
  root.render(
    <main className="reel-status-page">
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      <p>
        <a href="./transcript.html">Read the transcript instead</a>
      </p>
    </main>,
  );
}

async function start() {
  const params = new URLSearchParams(location.search);
  let raw: unknown;
  let transcript: TranscriptLine[] = [];
  try {
    // Relative URLs, so the bundle works under any base path.
    const [project, lines] = await Promise.all([
      fetch('./project.reel.json'),
      fetch('./transcript.json'),
    ]);
    if (!project.ok) throw new Error(`HTTP ${project.status}`);
    raw = await project.json();
    // The transcript is a convenience. The story still plays without it.
    if (lines.ok) transcript = parseTranscript(await lines.json());
  } catch (error) {
    showProblem('This demo could not load', `The project file could not be read: ${String(error)}`);
    return;
  }

  const parsed = parseProject(raw);
  if (!parsed.ok) {
    showProblem('This demo could not load', parsed.errors.slice(0, 5).join(' '));
    return;
  }
  const resolved = await resolveScene(parsed.project, SCENES);
  if (!resolved.ok) {
    showProblem('This demo needs a different scene', resolved.message);
    return;
  }
  const issues = [
    ...validateCommandShapes(resolved.adapter, resolved.project),
    ...validateTracks(resolved.adapter, resolved.project),
  ];
  if (issues.length > 0) {
    showProblem('This demo cannot play', issues[0]!.message);
    return;
  }
  document.title = resolved.project.title;
  root.render(
    <StrictMode>
      <Viewer
        adapter={resolved.adapter}
        project={resolved.project}
        transcript={transcript}
        variant={params.get('embed') === '1' ? 'embed' : 'full'}
        autoplay={params.get('play') === '1'}
      />
    </StrictMode>,
  );
}

void start();
