/**
 * Seeded source mutants, run against the unit tests in a separate clean clone, so a crash
 * here can never leave this checkout modified. The unmodified suite runs first in the same
 * place: a kill only means something if that run passed. Each kill records which test
 * failed, so a kill can be read rather than counted.
 *
 *   pnpm exec tsx bench/run-mutants.ts --label final
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { label: { type: 'string', default: 'draft' } } });

interface Mutant {
  id: string;
  file: string;
  find: string | RegExp;
  replace: string;
  /** A known equivalent mutant cannot be killed. Listed with the reason. */
  equivalent?: string;
}

const MUTANTS: Mutant[] = [
  { id: 'seek-no-token', file: 'src/core/seek.ts', find: 'if (token !== this.latest) return;', replace: '' },
  { id: 'seek-prepare-ignores-pending', file: 'src/core/seek.ts', find: 'if (!this.pending) {', replace: 'if (true) {' },
  { id: 'seek-close-keeps-walking', file: 'src/core/seek.ts', find: 'await this.yieldToHost();\n        if (this.closed) return;', replace: 'await this.yieldToHost();' },
  { id: 'playback-no-frame-clamp', file: 'src/core/playback.ts', find: 'Math.min(now - this.lastFrame, MAX_FRAME_MS)', replace: 'now - this.lastFrame' },
  { id: 'playback-no-resume', file: 'src/core/playback.ts', find: 'if (resume) this.play();', replace: '' },
  { id: 'playback-resume-at-end', file: 'src/core/playback.ts', find: 'this.resumeAfterSeek && time < range.end', replace: 'this.resumeAfterSeek' },
  { id: 'playback-pause-keeps-resume', file: 'src/core/playback.ts', find: 'pause(): void {\n    this.resumeAfterSeek = false;', replace: 'pause(): void {' },
  { id: 'playback-tick-no-end-stop', file: 'src/core/playback.ts', find: 'const playing = t < this.range.end;', replace: 'const playing = true;' },
  { id: 'playback-no-round', file: 'src/core/playback.ts', find: 'const t = Math.round(Math.min(this.range.end, Math.max(this.range.start, time)));', replace: 'const t = Math.min(this.range.end, Math.max(this.range.start, time));' },
  { id: 'playback-no-floor', file: 'src/core/playback.ts', find: 'const t = Math.floor(this.exactT);', replace: 'const t = this.exactT;' },
  { id: 'playback-skips-start-seek', file: 'src/core/playback.ts', find: '    this.seek(range.start);\n    this.ready', replace: '    this.ready' },
  { id: 'timeline-stores-stale', file: 'src/core/timeline.ts', find: 'if (count % every === 0) this.checkpoints[count / every] = state;', replace: 'if (count % every === 0) this.checkpoints[count / every] = cursor.state;' },
  { id: 'timeline-no-cap', file: 'src/core/timeline.ts', find: 'Math.max(options.checkpointEvery, Math.ceil(log.length / MAX_CHECKPOINTS))', replace: 'options.checkpointEvery' },
  { id: 'session-close-keeps-timers', file: 'src/core/session.ts', find: 'for (const handle of this.timers) this.options.host.clearTimer(handle);', replace: '' },
  { id: 'session-closed-guard', file: 'src/core/session.ts', find: "if (this.closed) return { ok: false, reason: 'This session has ended.' };", replace: '' },
  { id: 'session-outcome-as-user', file: 'src/core/session.ts', find: "this.accept(effect.command, 'outcome')", replace: "this.accept(effect.command, 'user')" },
  { id: 'session-no-rearm', file: 'src/core/session.ts', find: 'options.adapter.pendingEffects?.(options.state, options.startT) ?? []', replace: '[]' },
  { id: 'branch-shares-state', file: 'src/core/branch.ts', find: 'adapter.restore(structuredClone(adapter.serialize(state)), adapter.version) as S', replace: 'state' },
  { id: 'branch-editcount-all', file: 'src/core/branch.ts', find: "commands.filter((c) => c.source === 'user').length", replace: 'commands.length' },
  { id: 'branch-reopen-new-base', file: 'src/core/branch.ts', find: 'return { base: copy.base, session:', replace: 'return { base: { t: copy.base.t, hash: stateHash(adapter, copy.state) }, session:' },
  { id: 'receipt-preview-ignores-draft', file: 'src/scenes/receipt/state.ts', find: 'return computeBalances(members, expenses, draft);', replace: 'return computeBalances(members, expenses);' },
  {
    id: 'receipt-preview-stale-after-save',
    file: 'src/scenes/receipt/reduce.ts',
    find: 'preview: previewBalances(state.members, expenses, draft),\n        presentation: { flash: pending.expenseId }',
    replace: 'preview: state.preview,\n        presentation: { flash: pending.expenseId }',
    equivalent: 'After a save the draft equals the saved split, so the preview cannot change.',
  },
  { id: 'receipt-cancel-noop', file: 'src/scenes/receipt/reduce.ts', find: 'return withDraft(state, { ...draft, split: expense.split }, null);', replace: 'return withDraft(state, draft, null);' },
  { id: 'receipt-no-pending-outcome', file: 'src/scenes/receipt/adapter.ts', find: 'state.pendingSave === null ? [] : [saveOutcome(state.pendingSave.requestId)]', replace: '[]' },
  { id: 'retry-nextattempt', file: 'src/scenes/retry-queue/state.ts', find: 'nextAttemptAt: clock.t + delayMs', replace: 'nextAttemptAt: clock.t' },
  { id: 'retry-attempt-t', file: 'src/scenes/retry-queue/state.ts', find: '{ n: made, t: clock.t, status, delayMs }', replace: '{ n: made, t: 0, status, delayMs }' },
  { id: 'retry-createdat', file: 'src/scenes/retry-queue/state.ts', find: 'createdAt: clock.t', replace: 'createdAt: 0' },
  { id: 'retry-health-ignored', file: 'src/scenes/retry-queue/adapter.ts', find: 'status: state.healthy ? 200 : 503', replace: 'status: 503' },
  { id: 'project-no-sort', file: 'src/core/project.ts', find: 'commands.sort(compareEntries);', replace: '' },
  { id: 'project-trim-equal', file: 'src/core/project.ts', find: 'raw.start < raw.end', replace: 'raw.start <= raw.end' },
  { id: 'project-viewer-keeps-tail', file: 'src/core/project.ts', find: 'commands: project.commands.filter((c) => c.t <= end),', replace: 'commands: project.commands,' },
  { id: 'location-no-range', file: 'src/core/location.ts', find: /return t >= range\.start && t <= range\.end \? \{ kind: 'time', t \} : null;/, replace: "return { kind: 'time', t };" },
  { id: 'transcript-ignores-trim', file: 'src/core/transcript.ts', find: 'if (entry.t > range.end) break;', replace: '' },
  { id: 'drafts-no-previous', file: 'src/storage/drafts.ts', find: 'previous: old?.current ?? null,', replace: 'previous: null,' },
  { id: 'edit-undo-keeps-future', file: 'src/core/edit.ts', find: 'future: [history.present, ...history.future],', replace: 'future: [],' },
  { id: 'bundle-no-escape', file: 'src/export/bundle.ts', find: ".replaceAll('<', '&lt;')", replace: '' },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: these strings are source code to match.
  { id: 'bundle-replace-pattern', file: 'src/export/bundle.ts', find: "() => `<title>${title}</title>`", replace: '`<title>${title}</title>`' },
  {
    id: 'canonical-neg-zero',
    file: 'src/core/canonical.ts',
    find: 'return value === 0 ? 0 : value;',
    replace: 'return value;',
    equivalent: 'JSON.stringify already writes -0 as 0, so the output is the same.',
  },
];

const clone = await mkdtemp(join(tmpdir(), 'reel-mutants-'));
const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: clone, encoding: 'utf8', timeout: 180_000 });

execFileSync('git', ['clone', '-q', process.cwd(), clone]);
execFileSync('pnpm', ['install', '--frozen-lockfile', '--offline'], { cwd: clone, stdio: 'pipe' });

const firstFailure = (output: string) =>
  /FAIL\s+(.+)/.exec(output.replace(/\[[0-9;]*m/g, ''))?.[1]?.trim().slice(0, 120) ?? 'unknown';

const clean = run('pnpm', ['exec', 'vitest', 'run']);
if (clean.status !== 0) {
  console.error(`The unmodified suite failed here, so no kill can be trusted.\n${clean.stdout.slice(-800)}`);
  process.exit(1);
}
console.log('Unmodified suite passed in the clone.');

const results: unknown[] = [];
for (const mutant of MUTANTS) {
  const path = join(clone, mutant.file);
  const source = await readFile(path, 'utf8');
  const mutated = source.replace(mutant.find, () => mutant.replace);
  if (mutated === source) {
    results.push({ id: mutant.id, result: 'did not apply' });
    console.log(`did not apply  ${mutant.id}`);
    continue;
  }
  await writeFile(path, mutated);
  const outcome = run('pnpm', ['exec', 'vitest', 'run']);
  await writeFile(path, source);
  const killed = outcome.status !== 0;
  const result = killed ? 'killed' : mutant.equivalent ? 'equivalent' : 'SURVIVED';
  const by = killed ? firstFailure(outcome.stdout + outcome.stderr) : (mutant.equivalent ?? null);
  results.push({ id: mutant.id, file: mutant.file, result, by });
  console.log(`${result.padEnd(11)} ${mutant.id}${by === null ? '' : `: ${by}`}`);
}

await rm(clone, { recursive: true, force: true });
const out = join('runs', `${new Date().toISOString().slice(0, 10)}-${values.label}`);
await mkdir(out, { recursive: true });
await writeFile(join(out, 'mutants.json'), `${JSON.stringify(results, null, 2)}\n`);
const survived = results.filter((r) => (r as { result: string }).result !== 'killed' && (r as { result: string }).result !== 'equivalent');
console.log(`${results.length - survived.length} of ${results.length} accounted for. ${survived.length} left.`);
