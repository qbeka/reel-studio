/**
 * Writes the retry queue story shown on the project page. It drives the real scene through
 * a LiveSession with a scripted clock, so every command passed the same checks as a click
 * in the editor, and every outcome came from the scene's own fixture endpoint. The camera
 * and captions are placed on the times those commands landed at.
 *
 *   tsx scripts/author-retry-demo.ts
 */
import { writeFile } from 'node:fs/promises';
import type { Payload } from '../src/core/adapter';
import { FORMAT, FORMAT_VERSION, type ReelProject } from '../src/core/project';
import { LiveSession, type SessionHost } from '../src/core/session';
import { retryAdapter } from '../src/scenes/retry-queue/adapter';

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

const seed = 11;
const session = new LiveSession({
  adapter: retryAdapter,
  host,
  state: retryAdapter.init(seed),
  startT: 0,
  startSeq: 1,
  onChange: () => {},
});

function at(t: number, type: string, payload: Payload = {}) {
  waitUntil(t);
  const result = session.send(type, payload);
  if (!result.ok) throw new Error(`${type}: ${result.reason}`);
}

const policy = { maxAttempts: 4, baseDelayMs: 400, jitterPercent: 25 };

// The endpoint starts out failing. One event runs out of attempts and is dead lettered.
at(1500, 'enqueue');
// Two more attempts are allowed, and the dead letter goes back in the queue.
at(8300, 'setPolicy', { ...policy, maxAttempts: 5 });
at(9100, 'setPolicy', { ...policy, maxAttempts: 6 });
at(10600, 'requeue', { job: 'job-1' });
// The endpoint recovers while the event is waiting, so its next try is delivered.
at(13300, 'setHealthy', { healthy: true });
at(17400, 'enqueue');
waitUntil(20500);

const firstFail = session.log.find((entry) => entry.type === 'attemptResult')!.t;
const dead = session.log.filter((entry) => entry.type === 'attemptResult')[3]!.t;
const delivered = session.log.find((entry) => entry.type === 'attemptResult' && entry.payload.status === 200)!.t;

const project: ReelProject = {
  format: FORMAT,
  formatVersion: FORMAT_VERSION,
  id: 'retry-queue-demo',
  title: 'Rescue a dead letter',
  disclosure: 'Synthetic data with no real endpoint, events or accounts',
  scene: { id: retryAdapter.id, version: retryAdapter.version },
  seed,
  checkpointEvery: 256,
  trim: null,
  posterT: dead + 900,
  commands: session.log,
  chapters: [
    { id: 'send', t: 0, title: 'Send into a failing endpoint' },
    { id: 'backoff', t: firstFail, title: 'Watch it back off' },
    { id: 'policy', t: 8300 - 500, title: 'Allow more attempts' },
    { id: 'requeue', t: 10600, title: 'Requeue the dead letter' },
    { id: 'recover', t: 13300, title: 'The endpoint recovers' },
  ],
  captions: [
    { id: 'cap-send', start: 300, end: firstFail, text: 'The endpoint is failing, so send it an event and see what the queue does', target: 'send' },
    { id: 'cap-backoff', start: firstFail + 100, end: dead, text: 'Every attempt gets a 503, and each wait is about twice the last', target: 'jobs' },
    { id: 'cap-dead', start: dead + 100, end: 8300 - 600, text: 'After four attempts the policy gives up and the event is a dead letter', target: 'jobs' },
    { id: 'cap-policy', start: 8300 - 500, end: 10600 - 300, text: 'Raise the limit to six attempts', target: 'policy' },
    { id: 'cap-requeue', start: 10600 - 200, end: 13300 - 300, text: 'Requeue it and it starts failing again, since nothing has been fixed yet', target: 'jobs' },
    { id: 'cap-recover', start: 13300 - 200, end: 17400 - 400, text: 'Bring the endpoint back while the event waits, and its next try is delivered', target: 'endpoint' },
    { id: 'cap-next', start: 17400 - 300, end: 20500, text: 'A new event now goes through on its first attempt', target: 'send' },
  ],
  camera: [
    { id: 'shot-open', t: 0, target: null },
    { id: 'shot-jobs', t: firstFail + 200, target: 'jobs' },
    { id: 'shot-policy', t: 8300 - 300, target: null },
    { id: 'shot-requeue', t: delivered - 1200, target: 'jobs' },
    { id: 'shot-end', t: 17400 - 500, target: null },
  ],
};

await writeFile('projects/retry-queue.reel.json', `${JSON.stringify(project, null, 2)}\n`);
for (const entry of session.log) console.log(entry.t, entry.source, entry.type, JSON.stringify(entry.payload));
console.log(`${session.log.length} commands written.`);
