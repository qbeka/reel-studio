/**
 * Correctness runs, kept apart from timing. It checks seek against replay at declared
 * positions, the independent oracles after every command, and all negative controls.
 *
 *   pnpm exec tsx bench/run-correctness.ts --label final
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseProject } from '../src/core/project';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import { retryAdapter } from '../src/scenes/retry-queue/adapter';
import { auditReceipt, auditRetry } from './audit';
import { runControls } from './controls';
import { WORKLOADS, receiptLog, retryLog } from './fixtures';
import { checkSeeking, seekPositions } from './harness';

const { values } = parseArgs({ options: { label: { type: 'string', default: 'draft' } } });
const INTERVAL = 256;

const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split-release.reel.json', 'utf8')));
if (!parsed.ok) throw new Error(parsed.errors.join(' '));

const receiptRuns = [
  { name: 'short', log: parsed.project.commands, seed: parsed.project.seed },
  { name: 'long', log: receiptLog(WORKLOADS.long), seed: WORKLOADS.long.seed },
  { name: 'stress', log: receiptLog(WORKLOADS.stress), seed: WORKLOADS.stress.seed },
];

const seeks: unknown[] = [];
for (const { name, log, seed } of receiptRuns) {
  const every = name === 'short' ? 4 : INTERVAL;
  const positions = seekPositions(log, every, name === 'stress' ? 400 : 300, 11);
  const result = checkSeeking(receiptAdapter, log, seed, every, positions);
  const compareEvery = name === 'stress' ? 25 : 1;
  const problems = auditReceipt(receiptAdapter, log, seed, compareEvery);
  seeks.push({
    scene: 'receipt-split',
    workload: name,
    commands: log.length,
    checkpointEvery: every,
    positions: result.positions,
    mismatches: result.mismatches.length,
    oracleCommands: log.length,
    oracleComparesEvery: compareEvery,
    oracleProblems: problems.length,
  });
  console.log(JSON.stringify(seeks.at(-1)));
}

const retry = retryLog({ commands: 5000, seed: 22 });
const retryPositions = seekPositions(retry, INTERVAL, 300, 12);
const retrySeek = checkSeeking(retryAdapter, retry, 22, INTERVAL, retryPositions);
seeks.push({
  scene: 'retry-queue',
  workload: 'generated',
  commands: retry.length,
  checkpointEvery: INTERVAL,
  positions: retrySeek.positions,
  mismatches: retrySeek.mismatches.length,
  oracleCommands: retry.length,
  oracleComparesEvery: 1,
  oracleProblems: auditRetry(retryAdapter, retry, 22).length,
});
console.log(JSON.stringify(seeks.at(-1)));

const controls = await runControls();
const missed = controls.filter((c) => !c.detected);
console.log(`Controls: ${controls.length - missed.length} of ${controls.length} detected.`);

const out = join('runs', `${new Date().toISOString().slice(0, 10)}-${values.label}`);
await mkdir(out, { recursive: true });
await writeFile(join(out, 'correctness.json'), `${JSON.stringify({ seeks, controls }, null, 2)}\n`);
if (missed.length > 0) {
  console.error('A negative control went undetected. This result is invalid.');
  process.exit(1);
}
