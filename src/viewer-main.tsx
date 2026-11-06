import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseProject } from './core/project';
import { resolveScene } from './core/registry';
import { validateProject } from './core/project';
import { Viewer } from './player/Viewer';
import { SCENES } from './scenes/registry';
import './styles/fonts.css';
import './styles/tokens.css';
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
  try {
    // A relative URL, so the bundle works under any base path.
    const response = await fetch('./project.reel.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  } catch (error) {
    showProblem('This demo could not load', `The project file could not be read. ${String(error)}`);
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
  const issues = validateProject(resolved.adapter, resolved.project);
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
        embedded={params.get('embed') === '1'}
        autoplay={params.get('play') === '1'}
      />
    </StrictMode>,
  );
}

void start();
