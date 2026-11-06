import { type ReactElement, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnyAdapter, LayoutName } from '../core/adapter';
import { canonicalJson } from '../core/canonical';
import { type ReelProject, formatTime } from '../core/project';
import { hashJson, sha256, sha256Text } from '../core/sha256';
import { Timeline } from '../core/timeline';
import { type TranscriptLine, buildTranscript } from '../core/transcript';

export const MANIFEST_PATH = 'bundle-manifest.json';

export interface BundleManifest {
  format: 'reel-bundle';
  formatVersion: 1;
  projectId: string;
  title: string;
  scene: { id: string; version: number };
  /** Hash of the canonical project. Identifies the story independent of file formatting. */
  projectHash: string;
  /** Hash of the state after the last command. A viewer must reproduce it. */
  finalStateHash: string;
  commandCount: number;
  files: { path: string; bytes: number; sha256: string }[];
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function transcriptHtml(lines: readonly TranscriptLine[]): string {
  return lines
    .map((line) =>
      line.kind === 'chapter'
        ? `<li class="chapter"><time>${formatTime(line.t)}</time> ${escapeHtml(line.title)}</li>`
        : `<li><time>${formatTime(line.t)}</time> ${escapeHtml(line.text)}</li>`,
    )
    .join('\n');
}

const pageStyle = `
  body { margin: 0 auto; max-width: 680px; padding: 32px 20px 56px; background: #fbf8f4; color: #111511;
    font: 17px/1.5 Georgia, 'Times New Roman', serif; }
  h1 { font-weight: 400; font-size: 30px; line-height: 1.15; margin: 0 0 6px; }
  p { color: #444944; margin: 0 0 18px; font-size: 15px; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { padding: 4px 0; }
  li.chapter { margin-top: 12px; font-size: 19px; }
  time { display: inline-block; min-width: 3em; color: #5a5e5a; font: 13px/1 system-ui, sans-serif; }
`;

/** A complete page with no script at all, for readers who want or need plain text. */
function renderTranscriptPage(project: ReelProject, lines: readonly TranscriptLine[]): string {
  const title = escapeHtml(project.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: transcript</title>
<style>${pageStyle}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${escapeHtml(project.disclosure)}</p>
<ol>
${transcriptHtml(lines)}
</ol>
<p style="margin-top:24px"><a href="./index.html">Open the interactive demo</a></p>
</main>
</body>
</html>
`;
}

/**
 * One layout of the poster. The scene renders to static HTML inside an SVG, whose viewBox
 * scales it to any width with no script. `foreignObject` is what allows HTML in an SVG.
 */
function posterLayer(adapter: AnyAdapter, state: unknown, layout: LayoutName): string {
  const size = adapter.layouts[layout];
  const element: ReactElement = createElement(adapter.Render, {
    state,
    send: () => {},
    interactive: false,
    layout,
  });
  const markup = renderToStaticMarkup(element);
  return `<svg class="poster poster-${layout}" viewBox="0 0 ${size.width} ${size.height}" aria-hidden="true"><foreignObject width="${size.width}" height="${size.height}"><div xmlns="http://www.w3.org/1999/xhtml" inert="" style="width:${size.width}px;height:${size.height}px">${markup}</div></foreignObject></svg>`;
}

/**
 * The page a host embeds in an iframe. It has no script, so loading it costs one small
 * HTML file, one stylesheet and two fonts. A plain link starts the viewer, and the viewer
 * links back here, which unloads it completely.
 */
function renderEmbedPage(
  project: ReelProject,
  adapter: AnyAdapter,
  posterState: unknown,
  stylesheet: string,
): string {
  const title = escapeHtml(project.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="./${stylesheet}">
<style>
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; background: #fbf8f4; }
  .embed { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; }
  .poster { display: block; width: 100%; height: auto; max-height: 100%; }
  .poster-narrow { display: none; }
  @media (max-width: 559px) { .poster-wide { display: none; } .poster-narrow { display: block; } }
  .start { position: absolute; left: 50%; bottom: 20px; translate: -50% 0; display: inline-flex; align-items: center;
    min-height: 44px; padding: 10px 22px; border-radius: 999px; background: #121412; color: #fff;
    font: 16px/1.2 'Geist Sans', system-ui, sans-serif; text-decoration: none; white-space: nowrap; }
  .start:focus-visible { outline: 2px solid #1d3a2a; outline-offset: 3px; }
  .note { margin: 0; padding: 6px 12px; color: #5a5e5a; font: 13px/1.3 'Geist Sans', system-ui, sans-serif; }
  .note a { color: inherit; }
</style>
</head>
<body>
<div class="embed">
${posterLayer(adapter, posterState, 'wide')}
${posterLayer(adapter, posterState, 'narrow')}
<a class="start" href="./index.html?embed=1&amp;play=1">Play interactive demo<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">: ${title}</span></a>
</div>
<p class="note">${escapeHtml(project.disclosure)} <a href="./transcript.html">Read the transcript</a></p>
</body>
</html>
`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Builds every file of a static viewer bundle. `runtime` is the prebuilt viewer. The same
 * function runs in the command line exporter and in the editor, so both produce the same
 * files. The result depends only on its inputs, with no timestamps, so two exports of one
 * project are byte identical.
 *
 * The project must already have passed `validateProject`.
 */
export function assembleBundle(
  project: ReelProject,
  adapter: AnyAdapter,
  runtime: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const viewerHtml = runtime.get('viewer.html');
  if (viewerHtml === undefined) throw new Error('The viewer runtime has no viewer.html.');
  const stylesheet = [...runtime.keys()].find((p) => p.endsWith('.css'));
  if (stylesheet === undefined) throw new Error('The viewer runtime has no stylesheet.');

  const timeline = new Timeline(adapter, project.commands, {
    seed: project.seed,
    checkpointEvery: project.checkpointEvery,
  });
  const lines = buildTranscript(adapter, project);
  const title = escapeHtml(project.title);

  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of runtime) {
    if (path !== 'viewer.html') files.set(path, bytes);
  }

  const noscript = `<noscript><main style="max-width:680px;margin:32px auto;padding:0 20px"><h1>${title}</h1><p>${escapeHtml(project.disclosure)}</p><ol>${transcriptHtml(lines)}</ol></main></noscript>`;
  const index = decoder
    .decode(viewerHtml)
    .replace('<title>Reel demo</title>', `<title>${title}</title>`)
    .replace('<!--reel:noscript-->', noscript);
  files.set('index.html', encoder.encode(index));

  files.set('transcript.html', encoder.encode(renderTranscriptPage(project, lines)));
  files.set(
    'embed.html',
    encoder.encode(
      renderEmbedPage(project, adapter, timeline.stateAt(project.posterT), stylesheet),
    ),
  );
  files.set('project.reel.json', encoder.encode(JSON.stringify(project)));

  const listed = [...files.entries()]
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest: BundleManifest = {
    format: 'reel-bundle',
    formatVersion: 1,
    projectId: project.id,
    title: project.title,
    scene: project.scene,
    projectHash: sha256Text(canonicalJson(project)),
    finalStateHash: hashJson(adapter.serialize(timeline.stateAfter(project.commands.length))),
    commandCount: project.commands.length,
    files: listed,
  };
  files.set(MANIFEST_PATH, encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return files;
}

export function bundleSize(files: ReadonlyMap<string, Uint8Array>): number {
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  return total;
}
