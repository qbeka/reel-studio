import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnyAdapter } from '../src/core/adapter';
import { type ReelProject, parseProject } from '../src/core/project';
import { buildTranscript } from '../src/core/transcript';
import { Viewer } from '../src/player/Viewer';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import '../src/styles/foundation.css';
import '../src/styles/player.css';
import '../src/styles/scene-receipt.css';
import { Author } from './Author';
import recording from '../projects/receipt-split-release.reel.json';
import './page.css';

/** Inside the validation error, once the ring from the refused save has gone. */
const OPENING_T = 10_600;

const adapter = receiptAdapter as AnyAdapter;
const parsed = parseProject(recording);
if (!parsed.ok) throw new Error(parsed.errors.join(' '));
const original = parsed.project;

function Page() {
  const [project, setProject] = useState<ReelProject>(original);
  return (
    <Viewer
      variant="page"
      autoplay={false}
      adapter={adapter}
      project={project}
      transcript={buildTranscript(adapter, project)}
      startAt={OPENING_T}
      author={(context) => (
        <Author
          adapter={adapter}
          original={original}
          project={project}
          onChange={setProject}
          context={context}
        />
      )}
    />
  );
}

createRoot(document.getElementById('stage')!).render(<Page />);
