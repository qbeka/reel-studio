/**
 * Lists the release artifacts with their hashes, sizes and sources.
 *
 *   pnpm exec tsx scripts/artifact-manifest.ts
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';

const ARTIFACTS: { path: string; description: string }[] = [
  { path: 'runs/2026-11-06-release/receipt-split-viewer.zip', description: 'Exported viewer of the release story, built by the editor in a browser.' },
  { path: 'runs/2026-11-06-release/project.reel.json', description: 'The release story, recorded through the editor.' },
  { path: 'runs/2026-11-06-acceptance/retry-queue-viewer.zip', description: 'Exported viewer from the acceptance run on the second scene.' },
  { path: 'runs/2026-11-09-redesign/manifest.json', description: 'Benchmark manifest, protocol 3, on the redrawn viewer.' },
  { path: 'runs/2026-11-09-redesign/summary.json', description: 'Run level statistics computed from raw samples.' },
  { path: 'runs/2026-11-09-redesign/correctness.json', description: 'Seek, oracle and negative control results.' },
  { path: 'runs/2026-11-06-final/manifest.json', description: 'Benchmark manifest of the first protocol 3 run.' },
  { path: 'runs/2026-11-06-final/summary.json', description: 'Run level statistics of the first run.' },
  { path: 'runs/2026-11-06-final/correctness.json', description: 'Seek, oracle and negative control results of the first run.' },
  { path: 'runs/2026-11-06-final/mutants.json', description: 'Mutation results with the test that killed each mutant.' },
  { path: 'docs/media/cover.png', description: 'Cover, from the real viewer.' },
  { path: 'docs/media/poster.png', description: 'Embed poster, from the real export.' },
  { path: 'docs/media/demo.mp4', description: '18 second recording of the signature interaction.' },
  { path: 'docs/media/walkthrough.mp4', description: '63 second silent technical walkthrough with on-screen notes.' },
];

const rows = [];
for (const { path, description } of ARTIFACTS) {
  const bytes = await readFile(path);
  rows.push({
    path,
    bytes: (await stat(path)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    description,
  });
}
await writeFile('docs/artifacts.json', `${JSON.stringify(rows, null, 2)}\n`);
console.log(`${rows.length} artifacts listed.`);
