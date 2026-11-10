import { startTransition, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

type DemoId = 'receipts' | 'retries';

interface Demo {
  id: DemoId;
  /** The invented product, and what it does in two words. */
  name: string;
  about: string;
  adapter: AnyAdapter;
  project: ReelProject;
  /** Where the page opens the story. */
  opening: number;
  /** The folder its exported viewer is served from. */
  folder: string;
}

function parsed(input: unknown): ReelProject {
  const result = parseProject(input);
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.project;
}

const receipts: Demo = {
  id: 'receipts',
  name: 'Tabkin',
  about: 'receipts',
  adapter: receiptAdapter as AnyAdapter,
  project: parsed(recording),
  opening: OPENING_T,
  folder: 'demo/',
};

/** The second demo is a different product, and its code loads when someone asks for it. */
async function loadRetries(): Promise<Demo> {
  const [{ retryAdapter }, file] = await Promise.all([
    import('../src/scenes/retry-queue/adapter'),
    import('../projects/retry-queue.reel.json'),
    import('../src/styles/scene-retry-queue.css'),
  ]);
  const project = parsed(file.default);
  return {
    id: 'retries',
    name: 'Relaymoth',
    about: 'retries',
    adapter: retryAdapter as AnyAdapter,
    project,
    opening: project.posterT,
    folder: 'demo-retries/',
  };
}

const CHOICES: readonly { id: DemoId; name: string; about: string }[] = [
  { id: 'receipts', name: 'Tabkin', about: 'receipts' },
  { id: 'retries', name: 'Relaymoth', about: 'retries' },
];

const asked = (): DemoId => (new URLSearchParams(location.search).get('demo') === 'retries' ? 'retries' : 'receipts');

function Player({ demo, onNext }: { demo: Demo; onNext: () => void }) {
  const [project, setProject] = useState<ReelProject>(demo.project);
  const other = CHOICES.find((choice) => choice.id !== demo.id)!;
  return (
    <Viewer
      variant="page"
      autoplay={false}
      adapter={demo.adapter}
      project={project}
      transcript={buildTranscript(demo.adapter, project)}
      startAt={demo.opening}
      next={{ label: `Watch the ${other.name} demo`, onSelect: onNext }}
      author={(context) => (
        <Author
          adapter={demo.adapter}
          original={demo.project}
          project={project}
          onChange={setProject}
          context={context}
        />
      )}
    />
  );
}

function Page() {
  const [wanted, setWanted] = useState<DemoId>(asked);
  // A link to the second demo shows nothing until it has loaded, never the first one.
  const [demo, setDemo] = useState<Demo | null>(() => (asked() === 'receipts' ? receipts : null));
  const actions = document.getElementById('title-actions')!;

  // The choice is in the address, so a link opens the demo it was copied from.
  useEffect(() => {
    if (wanted === demo?.id) return;
    let live = true;
    const ready = wanted === 'receipts' ? Promise.resolve(receipts) : loadRetries();
    void ready.then((next) => {
      if (live) setDemo(next);
    });
    return () => {
      live = false;
    };
  }, [wanted, demo?.id]);

  const choose = useCallback((id: DemoId) => {
    setWanted(id);
    const url = new URL(location.href);
    if (id === 'receipts') url.searchParams.delete('demo');
    else url.searchParams.set('demo', id);
    // A moment belongs to one demo, so it does not follow to the other.
    history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, []);

  const shown = demo?.id;
  useEffect(() => {
    if (shown === undefined) return;
    document.documentElement.dataset.demo = shown;
    window.dispatchEvent(new CustomEvent('reel:demo', { detail: shown }));
  }, [shown]);

  return (
    <>
      {demo !== null && (
        <Player key={demo.id} demo={demo} onNext={() => choose(demo.id === 'receipts' ? 'retries' : 'receipts')} />
      )}
      {createPortal(
        <>
          <fieldset className="demo-switch">
            <legend className="sr-only">Which demo plays</legend>
            {CHOICES.map((choice) => (
              <label key={choice.id} data-active={wanted === choice.id} data-busy={wanted === choice.id && demo?.id !== choice.id}>
                <input
                  type="radio"
                  name="demo"
                  checked={wanted === choice.id}
                  onChange={() => choose(choice.id)}
                />
                <b>{choice.name}</b>
                <span>{choice.about}</span>
              </label>
            ))}
          </fieldset>
          <a className="control outline" href={(demo ?? receipts).folder}>
            Open the exported viewer
          </a>
        </>,
        actions,
      )}
    </>
  );
}

// Reading this file and drawing the stage are two pieces of work, so the browser gets a
// turn between them and neither holds the page for long.
setTimeout(() => {
  performance.mark('reel-stage');
  // The server sent a plain link in the title. The page's own controls replace it.
  document.getElementById('title-actions')!.replaceChildren();
  const root = createRoot(document.getElementById('stage')!);
  // As a transition the first draw is done in short slices, with the browser free between them.
  startTransition(() => root.render(<Page />));
}, 0);

// Sections under the stage arrive as they come into view. With reduced motion, or with no
// script at all, they are simply there.
const reveals = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
if (reveals.length > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('reveals');
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.reveal = 'in';
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  for (const element of reveals) seen.observe(element);
}

// The figures are below the first screen, so their code waits until someone scrolls near.
const figures = document.getElementById('details');
if (figures !== null) {
  let asked = false;
  const load = () => {
    if (asked) return;
    asked = true;
    void import('./figures').then((module) => {
      performance.mark('reel-figures');
      module.mountFigures();
    });
  };
  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          near.disconnect();
          load();
        }
      },
      { rootMargin: '600px 0px' },
    );
    near.observe(figures);
  } else {
    load();
  }
}
