/**
 * Writes the fixture story used by tests and benchmarks. It drives the real scene through
 * a LiveSession with a scripted clock, so every command passed the same checks as a click
 * in the editor. The release demo is recorded through the editor itself.
 *
 *   tsx scripts/author-receipt-demo.ts
 */
import { writeFile } from 'node:fs/promises';
import { FORMAT, FORMAT_VERSION, type ReelProject } from '../src/core/project';
import { LiveSession, type SessionHost } from '../src/core/session';
import { receiptAdapter } from '../src/scenes/receipt/adapter';

let now = 0;
const timers: { at: number; run: () => void }[] = [];
const host: SessionHost = {
  now: () => now,
  setTimer(run, delayMs) {
    const timer = { at: now + delayMs, run };
    timers.push(timer);
    return timer;
  },
  clearTimer(handle) {
    timers.splice(timers.indexOf(handle as (typeof timers)[number]), 1);
  },
};

function waitUntil(t: number) {
  while (timers.length > 0) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0]!;
    if (next.at > t) break;
    timers.shift();
    now = next.at;
    next.run();
  }
  now = t;
}

const seed = 7;
const session = new LiveSession({
  adapter: receiptAdapter,
  host,
  state: receiptAdapter.init(seed),
  startT: 0,
  startSeq: 1,
  onChange: () => {},
});

function at(t: number, type: string, payload = {}) {
  waitUntil(t);
  const result = session.send(type, payload);
  if (!result.ok) throw new Error(`${type}: ${result.reason}`);
}

at(1800, 'selectExpense', { id: 'e2' });
at(4600, 'setSplitMode', { mode: 'percent' });
at(6200, 'setSplit', { member: 'mina', value: 5000 });
at(7400, 'setSplit', { member: 'theo', value: 4000 });
at(8600, 'setSplit', { member: 'ana', value: 3000 });
at(10400, 'confirmEdit');
at(13800, 'setSplit', { member: 'ana', value: 1000 });
at(15400, 'confirmEdit');
at(18200, 'setView', { view: 'balances' });
waitUntil(22000);

const project: ReelProject = {
  format: FORMAT,
  formatVersion: FORMAT_VERSION,
  id: 'receipt-split-demo',
  title: 'Fix a shared receipt',
  disclosure: 'Synthetic data. No real people, receipts or balances.',
  scene: { id: receiptAdapter.id, version: receiptAdapter.version },
  seed,
  checkpointEvery: 256,
  trim: null,
  posterT: 14000,
  commands: session.log,
  chapters: [
    { id: 'open', t: 0, title: 'Open the receipt' },
    { id: 'adjust', t: 4600, title: 'Adjust the split' },
    { id: 'error', t: 10400, title: 'Hit a validation error' },
    { id: 'correct', t: 13000, title: 'Correct the shares' },
    { id: 'balances', t: 18200, title: 'Inspect the balances' },
  ],
  captions: [
    { id: 'cap-open', start: 300, end: 4300, text: 'Theo paid for dinner, split equally. Open that receipt.', target: 'expense-list' },
    { id: 'cap-adjust', start: 4700, end: 10200, text: 'Mina had more. Switch to percent and adjust the shares.', target: 'split-editor' },
    { id: 'cap-error', start: 10500, end: 13000, text: 'The shares add up to 120%, so the save is refused.', target: 'save' },
    { id: 'cap-correct', start: 13100, end: 18000, text: 'Lower Ana to 10% and the same save goes through.', target: 'split-editor' },
    { id: 'cap-balances', start: 18300, end: 22000, text: 'Balances are recomputed from every receipt.', target: 'balances' },
  ],
  camera: [
    { id: 'shot-open', t: 0, target: null },
    { id: 'shot-split', t: 4600, target: 'split-editor' },
    { id: 'shot-balances', t: 18200, target: null },
  ],
};

await writeFile('projects/receipt-split.reel.json', `${JSON.stringify(project, null, 2)}\n`);
console.log(`${session.log.length} commands written.`);
