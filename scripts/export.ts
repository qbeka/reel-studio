/**
 * Exports a project as a static bundle.
 *
 *   pnpm export projects/receipt-split.reel.json --out exports/receipt-split
 */
import { readFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { parseProject, validateProject } from '../src/core/project';
import { resolveScene } from '../src/core/registry';
import { assembleBundle, bundleSize } from '../src/export/bundle';
import { readTree, verifyBundle, writeBundle } from '../src/export/write';
import { SCENES } from '../src/scenes/registry';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' } },
});

const input = positionals[0];
if (input === undefined || values.out === undefined) {
  console.error('Usage: pnpm export <project.reel.json> --out <folder>');
  process.exit(2);
}

function stop(lines: readonly string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const started = performance.now();
const parsed = parseProject(JSON.parse(await readFile(input, 'utf8')));
if (!parsed.ok) stop(parsed.errors);
const resolved = await resolveScene(parsed.project, SCENES);
if (!resolved.ok) stop([resolved.message]);
const issues = validateProject(resolved.adapter, resolved.project);
if (issues.length > 0) stop(issues.map((issue) => issue.message));

const exists = await stat('dist/viewer/viewer.html').catch(() => null);
if (exists === null) stop(['The viewer is not built. Run: pnpm build:viewer']);

const runtime = await readTree('dist/viewer');
const files = assembleBundle(resolved.project, resolved.adapter, runtime);
await writeBundle(files, values.out);
const result = await verifyBundle(values.out);
if (!result.ok) stop(result.problems);

const ms = Math.round(performance.now() - started);
console.log(`Exported ${files.size} files, ${bundleSize(files)} bytes, to ${values.out} in ${ms} ms.`);
