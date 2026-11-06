/**
 * Times the command line exporter and records bundle sizes. Each repetition is one fresh
 * process, because that is what a person runs.
 *
 *   pnpm exec tsx bench/run-export.ts --label final
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { readTree } from '../src/export/write';

const { values } = parseArgs({ options: { label: { type: 'string', default: 'draft' } } });
const REPETITIONS = 5;
const WORKLOADS = ['short', 'long', 'stress'];

const out = join('runs', `${new Date().toISOString().slice(0, 10)}-${values.label}`);
await mkdir(out, { recursive: true });

const results: unknown[] = [];
for (const name of WORKLOADS) {
  const source = join('exports/bench', name, 'checkpointed', 'project.reel.json');
  await readFile(source);
  const times: number[] = [];
  for (let i = 0; i < REPETITIONS; i++) {
    const start = performance.now();
    execFileSync('pnpm', ['-s', 'exec', 'tsx', 'scripts/export.ts', source, '--out', join('exports/timing', name)], {
      stdio: 'pipe',
    });
    times.push(performance.now() - start);
  }
  const files = await readTree(join('exports/timing', name));
  let total = 0;
  let code = 0;
  let codeGzip = 0;
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (path.endsWith('.js') || path.endsWith('.css')) {
      code += bytes.length;
      codeGzip += gzipSync(bytes, { level: 9 }).length;
    }
  }
  const record = { workload: name, exportMs: times, totalBytes: total, codeBytes: code, codeGzipBytes: codeGzip };
  results.push(record);
  console.log(JSON.stringify(record));
}
await writeFile(join(out, 'export.json'), `${JSON.stringify(results, null, 2)}\n`);
