/**
 * Checks an exported folder against its manifest.
 *
 *   pnpm exec tsx scripts/verify-bundle.ts exports/receipt-split
 */
import { verifyBundle } from '../src/export/write';

const root = process.argv[2];
if (root === undefined) {
  console.error('Usage: pnpm exec tsx scripts/verify-bundle.ts <folder>');
  process.exit(2);
}
const result = await verifyBundle(root);
if (!result.ok) {
  for (const problem of result.problems) console.error(problem);
  process.exit(1);
}
console.log(`${root} verified: ${result.manifest?.files.length} files match the manifest.`);
