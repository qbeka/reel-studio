/**
 * Checks an exported folder: every file against its hash, then a full replay against the
 * final state hash in the manifest.
 *
 *   pnpm exec tsx scripts/verify-bundle.ts exports/receipt-split
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkReplay } from '../src/export/verify';
import { verifyBundle } from '../src/export/write';
import { SCENES } from '../src/scenes/registry';

const root = process.argv[2];
if (root === undefined) {
  console.error('Usage: pnpm exec tsx scripts/verify-bundle.ts <folder>');
  process.exit(2);
}
const result = await verifyBundle(root);
if (!result.ok || result.manifest === null) {
  for (const problem of result.problems) console.error(problem);
  process.exit(1);
}
const problem = await checkReplay(
  result.manifest,
  await readFile(join(root, 'project.reel.json'), 'utf8'),
  SCENES,
);
if (problem !== null) {
  console.error(problem);
  process.exit(1);
}
console.log(`${root} verified: ${result.manifest.files.length} files match, and the replay reproduces the final state.`);
