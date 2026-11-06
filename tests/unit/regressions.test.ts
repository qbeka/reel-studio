/**
 * Defects found by an independent review on a clean clone. Each test here failed before
 * its fix, so none of these can quietly return.
 */
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  editCount,
  isUnchanged,
  matchesStory,
  openBranch,
  reopenBranch,
  returnOptions,
} from '../../src/core/branch';
import { canonicalJson } from '../../src/core/canonical';
import { fileProblems, trimEnd, trimStart } from '../../src/core/edit';
import { Playback } from '../../src/core/playback';
import {
  type ReelProject,
  forViewer,
  parseProject,
  projectEnd,
  validateProject,
  validateTracks,
} from '../../src/core/project';
import { LiveSession, type SessionHost } from '../../src/core/session';
import { MAX_CHECKPOINTS, Timeline } from '../../src/core/timeline';
import { buildTranscript } from '../../src/core/transcript';
import { assembleBundle } from '../../src/export/bundle';
import { checkReplay } from '../../src/export/verify';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { MAX_RECEIPTS } from '../../src/scenes/receipt/reduce';
import { SCENES } from '../../src/scenes/registry';
import { retryAdapter } from '../../src/scenes/retry-queue/adapter';
import { MAX_JOBS } from '../../src/scenes/retry-queue/state';
import { receiptLog } from '../../bench/fixtures';
import { frozen, hashState } from './helpers';

const scene = frozen(receiptAdapter);

let base: ReelProject;
beforeAll(async () => {
  const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8')));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  base = parsed.project;
});

const story = () => new Timeline(scene, base.commands, { seed: base.seed, checkpointEvery: 4 });

function clock() {
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
      const i = timers.indexOf(handle as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    host,
    pending: () => timers.length,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

const noFrames = { request: () => 0, cancel: () => {} };

describe('branches', () => {
  it('a reopened copy still counts as changed from the story', () => {
    const { host } = clock();
    const timeline = story();
    const first = openBranch(scene, timeline.stateAt(9000), 9000, host, () => {});
    first.session.send('setSplit', { member: 'ana', value: 1000 });
    const copy = { state: first.session.state, base: first.base, t: first.session.t };
    const reopened = reopenBranch(scene, copy, host, () => {});
    expect(isUnchanged(scene, reopened)).toBe(false);
    expect(reopened.base).toEqual(first.base);
    expect(hashState(scene, reopened.session.state)).toBe(hashState(scene, first.session.state));
  });

  it('a fork during a save receives the outcome and can go on', () => {
    const { host, advance } = clock();
    const branch = openBranch(scene, story().stateAt(15500), 15500, host, () => {});
    expect(branch.session.state.pendingSave).not.toBeNull();
    expect(branch.session.pendingOutcomes).toBe(1);
    advance(1000);
    expect(branch.session.state.pendingSave).toBeNull();
    expect(branch.session.send('selectExpense', { id: 'e1' })).toMatchObject({ ok: true });
    expect(editCount(branch.session.log)).toBe(1);
  });

  it('a copy closed during a save can finish after it is reopened', () => {
    const { host, advance } = clock();
    const timeline = story();
    const first = openBranch(scene, timeline.stateAt(9000), 9000, host, () => {});
    first.session.send('setSplit', { member: 'ana', value: 1000 });
    first.session.send('confirmEdit');
    const copy = { state: first.session.state, base: first.base, t: first.session.t };
    first.session.close();
    const reopened = reopenBranch(scene, copy, host, () => {});
    advance(1000);
    expect(reopened.session.state.pendingSave).toBeNull();
  });

  it('a retry job forked mid attempt or mid wait keeps going', () => {
    const { host, advance } = clock();
    let state = retryAdapter.init(1);
    state = retryAdapter.apply(state, { type: 'enqueue', payload: {} }, { t: 100 });
    const sending = openBranch(retryAdapter, state, 150, host, () => {});
    expect(sending.session.pendingOutcomes).toBe(1);
    advance(300);
    expect(sending.session.state.jobs[0]!.status).toBe('waiting');
    expect(sending.session.pendingOutcomes).toBe(1);

    const due = sending.session.state.jobs[0]!.nextAttemptAt!;
    const copy = { state: sending.session.state, base: sending.base, t: due - 40 };
    sending.session.close();
    const reopened = reopenBranch(retryAdapter, copy, host, () => {});
    advance(39);
    expect(reopened.session.state.jobs[0]!.status).toBe('waiting');
    advance(2);
    expect(reopened.session.state.jobs[0]!.status).toBe('sending');
    reopened.session.close();
  });

  it('a recording that starts from a waiting state also receives the outcome', () => {
    const { host, advance } = clock();
    const session = new LiveSession({
      adapter: scene,
      host,
      state: story().stateAt(15500),
      startT: 15500,
      startSeq: 100,
      onChange: () => {},
    });
    advance(1000);
    expect(session.log.map((e) => e.type)).toEqual(['saveResult']);
  });

  it('match answers follow the state, not an earlier look at it', () => {
    const { host } = clock();
    const timeline = story();
    const chapters = base.chapters;
    const branch = openBranch(scene, timeline.stateAt(4000), 4000, host, () => {});
    branch.session.send('setSplitMode', { mode: 'percent' });
    const adjust = chapters.find((c) => c.id === 'adjust')!;
    expect(matchesStory(scene, timeline, adjust.t, branch.session.state)).toBe(true);
    branch.session.send('setSplit', { member: 'ana', value: 7700 });
    expect(matchesStory(scene, timeline, adjust.t, branch.session.state)).toBe(false);
    expect(returnOptions(scene, timeline, chapters, branch.session.state).some((o) => o.matches)).toBe(false);
  });
});

describe('playback', () => {
  const log = receiptLog({ commands: 50, expenses: 5, seed: 1 });
  const end = log.at(-1)!.t;
  const make = (range = { start: 0, end }, frames = noFrames) =>
    new Playback(new Timeline(scene, log, { seed: 1, checkpointEvery: 8 }), range, frames);

  it('seeking to the end while playing stays at the end', () => {
    const playback = make();
    playback.seek(1000);
    playback.play();
    playback.seek(end);
    expect(playback.getSnapshot()).toMatchObject({ t: end, playing: false });
  });

  it('a story with no length does not overflow the stack on play', () => {
    const playback = make({ start: 0, end: 0 });
    expect(() => playback.play()).not.toThrow();
    expect(playback.getSnapshot()).toMatchObject({ playing: false, error: null });
  });

  it('a command at exactly the start has already happened when the story opens', () => {
    const atZero = [{ seq: 1, t: 0, type: 'setView', payload: { view: 'balances' }, source: 'user' as const }];
    const timeline = new Timeline(scene, atZero, { seed: 1, checkpointEvery: 8 });
    const playback = new Playback(timeline, { start: 0, end: 100 }, noFrames);
    expect(playback.getSnapshot()).toMatchObject({ t: 0, count: 1 });
  });

  it('pausing during a seek cancels the resume', async () => {
    const waiting: (() => void)[] = [];
    const timeline = new Timeline(scene, log, { seed: 1, checkpointEvery: 100000 });
    const playback = new Playback(timeline, { start: 0, end }, noFrames, {
      sliceBudget: 1,
      sliceMs: 0,
      yieldToHost: () => new Promise((resolve) => waiting.push(resolve)),
    });
    playback.play();
    playback.seek(end - 500);
    expect(playback.getSnapshot().seeking).toBe(true);
    playback.pause();
    while (playback.getSnapshot().seeking) {
      for (const resume of waiting.splice(0)) resume();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(playback.getSnapshot()).toMatchObject({ t: end - 500, playing: false });
  });

  it('keeps time in whole milliseconds, with each state tied to its own time', () => {
    let queued: ((now: number) => void) | null = null;
    const frames = {
      request(run: (now: number) => void) {
        queued = run;
        return 1;
      },
      cancel: () => {},
    };
    const timeline = new Timeline(scene, log, { seed: 1, checkpointEvery: 8 });
    const playback = new Playback(timeline, { start: 0, end }, frames);
    playback.play();
    for (let i = 0; i < 40; i++) (queued as unknown as (n: number) => void)(i * 16.67);
    const { t, stateT, count } = playback.getSnapshot();
    expect(Number.isInteger(t)).toBe(true);
    expect(stateT).toBe(t);
    expect(count).toBe(timeline.countAt(t));
    playback.pause();
    playback.seek(100.4);
    expect(playback.getSnapshot().t).toBe(100);
  });
});

describe('sessions', () => {
  it('refuses commands after it closes', () => {
    const { host } = clock();
    const session = new LiveSession({
      adapter: scene,
      host,
      state: scene.init(1),
      startT: 0,
      startSeq: 1,
      onChange: () => {},
    });
    session.close();
    expect(session.send('selectExpense', { id: 'e1' })).toMatchObject({ ok: false });
    expect(session.log).toEqual([]);
  });
});

describe('limits', () => {
  it('stores a bounded number of states whatever interval a file asks for', () => {
    const log = receiptLog({ commands: 4000, expenses: 30, seed: 3 });
    const timeline = new Timeline(scene, log, { seed: 3, checkpointEvery: 1 });
    timeline.stateAfter(log.length);
    expect(timeline.checkpointCount).toBeLessThanOrEqual(MAX_CHECKPOINTS + 1);
  });

  it('caps the size of each scene, so each command stays bounded', () => {
    const full = { ...receiptAdapter.init(1), expenses: new Array(MAX_RECEIPTS).fill(null) };
    expect(receiptAdapter.precondition(full, { type: 'addReceipt', payload: {} })).toMatch(/full/);
    const queue = { ...retryAdapter.init(1), jobs: new Array(MAX_JOBS).fill({ id: 'x' }) };
    expect(retryAdapter.precondition(queue, { type: 'enqueue', payload: {} })).toMatch(/full/);
  });

  it('refuses a seq too large to count from exactly', () => {
    const command = { ...base.commands[0], seq: 2 ** 53 };
    expect(parseProject({ ...base, commands: [command] }).ok).toBe(false);
  });

  it('refuses an empty trim range', () => {
    expect(parseProject({ ...base, trim: { start: 5, end: 5 } }).ok).toBe(false);
  });
});

describe('what a file may hold', () => {
  const titled = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `chapter-${i}`, t: i, title: `Part ${i}` }));

  it('finds an edit that could not be read back', () => {
    expect(fileProblems(base)).toEqual([]);
    expect(fileProblems({ ...base, chapters: titled(64) })).toEqual([]);
    expect(fileProblems({ ...base, chapters: titled(65) })[0]).toMatch(/limit is 64/);
  });

  it('finds a payload nested deeper than a file allows', () => {
    let deep: object = { x: 1 };
    for (let i = 0; i < 10; i++) deep = { x: deep };
    const command = { ...base.commands[0]!, payload: deep as never };
    expect(fileProblems({ ...base, commands: [command] })).not.toEqual([]);
  });
});

describe('hashing', () => {
  it('a __proto__ key in a payload changes the hash', () => {
    const a = JSON.parse('{"__proto__":{"x":1},"b":2}');
    expect(canonicalJson(a)).not.toBe(canonicalJson({ b: 2 }));
    expect(canonicalJson(a)).toContain('__proto__');
  });
});

describe('trim', () => {
  it('sends a viewer nothing past the end, and keeps the prologue', () => {
    const project = forViewer({ ...base, trim: { start: 5000, end: 11000 }, posterT: 20000 });
    expect(project.commands.at(-1)!.t).toBeLessThanOrEqual(11000);
    expect(project.commands[0]!.t).toBeLessThan(5000);
    expect(project.chapters.every((c) => c.t >= 5000 && c.t <= 11000)).toBe(true);
    expect(project.posterT).toBe(11000);
  });

  it('a trim over a quiet stretch still makes a playable export', () => {
    const shipped = forViewer({ ...base, captions: [], camera: [], chapters: [], trim: { start: 11000, end: 13000 } });
    expect(projectEnd(shipped)).toBeLessThan(11000);
    expect(validateProject(receiptAdapter, shipped)).toEqual([]);
  });

  it('Start at keeps the rest of the story, including a final caption', () => {
    const end = projectEnd(base);
    expect(end).toBeGreaterThan(base.commands.at(-1)!.t);
    expect(trimStart(base, 5000).trim).toEqual({ start: 5000, end });
    expect(trimEnd(trimStart(base, 5000), 9000).trim).toEqual({ start: 5000, end: 9000 });
    expect(trimEnd(base, 0)).toBe(base);
  });

  it('leaves later steps out of the transcript', () => {
    const lines = buildTranscript(receiptAdapter, { ...base, trim: { start: 0, end: 12000 } });
    expect(lines.every((line) => line.t <= 12000)).toBe(true);
    expect(lines.some((l) => l.kind === 'step' && l.text.startsWith('Save confirmed'))).toBe(false);
  });

  it('a trim on a project with nothing recorded is not an error', () => {
    const empty = { ...base, commands: [], chapters: [], captions: [], camera: [] };
    expect(validateTracks(receiptAdapter, { ...empty, trim: { start: 0, end: 1 } })).toEqual([]);
  });
});

describe('export', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const runtime = new Map([
    ['viewer.html', encode('<title>Reel demo</title><head><script src=x.js></script></head><!--reel:noscript-->')],
    ['a.css', new Uint8Array()],
  ]);

  it.each([
    ['title', { title: 'Costs $& fees' }, '<title>Costs $&amp; fees</title>'],
    ['disclosure', { disclosure: 'pays $` now' }, 'pays $` now'],
  ])('keeps replacement patterns in the %s as plain text', (_name, patch, expected) => {
    const files = assembleBundle({ ...base, ...patch }, receiptAdapter, runtime);
    expect(new TextDecoder().decode(files.get('index.html'))).toContain(expected);
  });

  it('checks a replay against the manifest, and catches a changed story', async () => {
    const files = assembleBundle(base, receiptAdapter, runtime);
    const decode = (name: string) => new TextDecoder().decode(files.get(name));
    const manifest = JSON.parse(decode('bundle-manifest.json'));
    const text = decode('project.reel.json');
    expect(await checkReplay(manifest, text, SCENES)).toBeNull();

    const changed = JSON.parse(text);
    changed.commands = changed.commands.slice(0, -1);
    expect(await checkReplay(manifest, JSON.stringify(changed), SCENES)).toMatch(/does not match/);
  });
});

describe('editing a scene', () => {
  it('Undo changes restores the saved split', () => {
    let state = scene.init(1);
    const send = (type: string, payload = {}) => {
      state = scene.apply(state, { type, payload }, { t: 1 });
    };
    send('selectExpense', { id: 'e3' });
    send('setSplit', { member: 'mina', value: 100 });
    send('cancelEdit');
    expect(state.draft?.split.values.mina).toBe(5000);
    expect(state.validation).toBeNull();
    expect(state.preview).not.toBeNull();
  });
});
