import { describe, expect, it } from 'vitest';
import { editCount, isUnchanged, openBranch, returnOptions } from '../../src/core/branch';
import { canonicalJson } from '../../src/core/canonical';
import { parseMoment } from '../../src/core/location';
import type { SessionHost } from '../../src/core/session';
import { Timeline } from '../../src/core/timeline';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { entry, frozen, hashState, outcome } from './helpers';

const scene = frozen(receiptAdapter);

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
const advance = (ms: number) => {
  now += ms;
  for (const timer of timers.filter((x) => x.at <= now)) {
    timers.splice(timers.indexOf(timer), 1);
    timer.run();
  }
};

const log = [
  entry(100, 'selectExpense', { id: 'e2' }),
  entry(200, 'setSplitMode', { mode: 'percent' }),
  entry(300, 'setSplit', { member: 'mina', value: 5000 }),
  entry(400, 'setSplit', { member: 'theo', value: 2500 }),
  entry(500, 'setSplit', { member: 'ana', value: 2500 }),
  entry(600, 'confirmEdit'),
  outcome(1050, 'saveResult', { requestId: 1, ok: true }),
];

const chapters = [
  { id: 'open', t: 100, title: 'Open' },
  { id: 'percent', t: 200, title: 'Use percent' },
  { id: 'saved', t: 1050, title: 'Saved' },
];

function setup() {
  const timeline = new Timeline(scene, log, { seed: 1, checkpointEvery: 4 });
  const story = timeline.stateAt(250);
  const branch = openBranch(scene, story, 250, host, () => {});
  return { timeline, story, branch };
}

describe('viewer branch', () => {
  it('starts as an exact copy that shares no objects with the story', () => {
    const { story, branch } = setup();
    expect(hashState(scene, branch.session.state)).toBe(hashState(scene, story));
    expect(branch.session.state).not.toBe(story);
    expect(branch.session.state.expenses).not.toBe(story.expenses);
    expect(isUnchanged(scene, branch)).toBe(true);
  });

  it('never changes the authored log or the authored states', () => {
    const { timeline, branch } = setup();
    const logBefore = canonicalJson(log);
    const finalBefore = hashState(scene, timeline.stateAfter(log.length));
    branch.session.send('setSplit', { member: 'ana', value: 9000 });
    branch.session.send('confirmEdit');
    expect(canonicalJson(log)).toBe(logBefore);
    expect(hashState(scene, timeline.stateAfter(log.length))).toBe(finalBefore);
    expect(timeline.stateAt(250).draft?.split.values.ana).not.toBe(9000);
  });

  it('counts edits, not the outcomes they cause', () => {
    const { branch } = setup();
    branch.session.send('setSplit', { member: 'mina', value: 10000 });
    branch.session.send('setSplit', { member: 'theo', value: 0 });
    branch.session.send('setSplit', { member: 'ana', value: 0 });
    branch.session.send('confirmEdit');
    advance(1000);
    expect(branch.session.log.at(-1)?.type).toBe('saveResult');
    expect(editCount(branch.session.log)).toBe(4);
    branch.session.close();
  });

  it('keeps edits however long the viewer stays', () => {
    const { branch } = setup();
    branch.session.send('setSplit', { member: 'ana', value: 7000 });
    advance(60 * 60 * 1000);
    expect(branch.session.state.draft?.split.values.ana).toBe(7000);
    branch.session.close();
  });

  it('reports a match only for a chapter with the identical state', () => {
    const { timeline, branch } = setup();
    const untouched = returnOptions(scene, timeline, chapters, branch.session.state);
    expect(untouched.map((o) => o.matches)).toEqual([false, true, false]);

    branch.session.send('setSplit', { member: 'ana', value: 1 });
    const edited = returnOptions(scene, timeline, chapters, branch.session.state);
    expect(edited.map((o) => o.matches)).toEqual([false, false, false]);
    branch.session.close();
  });

  it('finds a match when the viewer reaches the authored state by their own edits', () => {
    const timeline = new Timeline(scene, log, { seed: 1, checkpointEvery: 4 });
    const branch = openBranch(scene, timeline.stateAt(100), 100, host, () => {});
    branch.session.send('setSplitMode', { mode: 'percent' });
    const options = returnOptions(scene, timeline, chapters, branch.session.state);
    expect(options.find((o) => o.chapter.id === 'percent')?.matches).toBe(true);
    branch.session.close();
  });
});

describe('links', () => {
  const range = { start: 0, end: 1050 };

  it.each([
    ['#t=500', { kind: 'time', t: 500 }],
    ['#t=0', { kind: 'time', t: 0 }],
    ['#chapter=saved', { kind: 'chapter', id: 'saved' }],
  ])('accepts %s', (hash, moment) => {
    expect(parseMoment(hash, chapters, range)).toEqual(moment);
  });

  it.each([
    '',
    '#',
    '#t=-1',
    '#t=1.5',
    '#t=99999',
    '#t=1e3',
    '#t=500&x=1',
    '#chapter=',
    '#chapter=missing',
    '#chapter=SAVED',
    '#chapter=<script>',
    '#state={"a":1}',
    '#t=00000000000000000000500',
  ])('ignores %s', (hash) => {
    expect(parseMoment(hash, chapters, range)).toBeNull();
  });
});
