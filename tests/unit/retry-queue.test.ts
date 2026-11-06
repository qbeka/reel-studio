import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import { LiveSession, type SessionHost } from '../../src/core/session';
import { Timeline } from '../../src/core/timeline';
import { ATTEMPT_MS, retryAdapter } from '../../src/scenes/retry-queue/adapter';
import { type RetryState, backoffMs } from '../../src/scenes/retry-queue/state';
import { frozen, hashState } from './helpers';

const scene = frozen(retryAdapter);

function fakeHost() {
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
    runUntil(t: number) {
      while (timers.length > 0) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0]!;
        if (next.at > t) break;
        timers.shift();
        now = next.at;
        next.run();
      }
      now = t;
    },
  };
}

function live(seed = 3) {
  const clock = fakeHost();
  const session = new LiveSession<RetryState>({
    adapter: scene,
    host: clock.host,
    state: scene.init(seed),
    startT: 0,
    startSeq: 1,
    onChange: () => {},
  });
  return { ...clock, session };
}

describe('backoffMs', () => {
  const policy = { maxAttempts: 5, baseDelayMs: 400, jitterPercent: 25 };

  it('doubles each attempt', () => {
    expect([1, 2, 3].map((n) => backoffMs(policy, n, 0))).toEqual([400, 800, 1600]);
  });

  it('adds at most the declared jitter', () => {
    expect(backoffMs(policy, 1, 0.999999)).toBeLessThanOrEqual(500);
    expect(backoffMs({ ...policy, jitterPercent: 0 }, 2, 0.9)).toBe(800);
  });
});

describe('the retry workflow', () => {
  it('retries a failing endpoint and moves the job to dead letters', () => {
    const { session, runUntil } = live();
    session.send('enqueue');
    runUntil(60_000);
    const job = session.state.jobs[0]!;
    expect(job.status).toBe('dead');
    expect(job.attempts.map((a) => a.status)).toEqual([503, 503, 503, 503]);
    expect(session.state.policy.maxAttempts).toBe(4);
  });

  it('waits the chosen delay between attempts', () => {
    const { session, runUntil } = live();
    session.send('enqueue');
    runUntil(60_000);
    const [a, b] = session.state.jobs[0]!.attempts;
    expect(b!.t - a!.t).toBe(a!.delayMs! + ATTEMPT_MS);
  });

  it('delivers once the endpoint recovers', () => {
    const { session, runUntil } = live();
    session.send('enqueue');
    runUntil(ATTEMPT_MS + 1);
    session.send('setHealthy', { healthy: true });
    runUntil(60_000);
    const job = session.state.jobs[0]!;
    expect(job.status).toBe('delivered');
    expect(job.attempts.at(-1)?.status).toBe(200);
  });

  it('requeues a dead letter from scratch', () => {
    const { session, runUntil } = live();
    session.send('enqueue');
    runUntil(60_000);
    session.send('setHealthy', { healthy: true });
    expect(session.send('requeue', { job: 'job-1' })).toMatchObject({ ok: true });
    runUntil(120_000);
    expect(session.state.jobs[0]).toMatchObject({ status: 'delivered' });
    expect(session.state.jobs[0]!.attempts).toHaveLength(1);
  });

  it('honours a policy change for attempts still to come', () => {
    const { session, runUntil } = live();
    session.send('setPolicy', { maxAttempts: 2, baseDelayMs: 100, jitterPercent: 0 });
    session.send('enqueue');
    runUntil(60_000);
    expect(session.state.jobs[0]!.attempts).toHaveLength(2);
  });

  it('replays to the same state from the log alone, including seeded jitter', () => {
    const { session, runUntil } = live(11);
    session.send('enqueue');
    session.send('enqueue');
    runUntil(900);
    session.send('setHealthy', { healthy: true });
    runUntil(60_000);
    expect(session.log.some((e) => e.source === 'outcome')).toBe(true);
    const timeline = new Timeline(scene, session.log, { seed: 11, checkpointEvery: 3 });
    expect(hashState(scene, timeline.stateAfter(session.log.length))).toBe(hashState(scene, session.state));
  });

  it('gives different jitter for a different seed', () => {
    const run = (seed: number) => {
      const { session, runUntil } = live(seed);
      session.send('enqueue');
      runUntil(60_000);
      return session.state.jobs[0]!.attempts.map((a) => a.delayMs);
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });
});

describe('preconditions', () => {
  const entry = (type: string, payload: LogEntry['payload']) => ({ type, payload });

  it.each([
    ['attemptResult', { job: 'job-9', attempt: 1, status: 200 }, /does not exist/],
    ['attemptDue', { job: 'job-9' }, /does not exist/],
    ['requeue', { job: 'job-9' }, /does not exist/],
  ])('refuses %s for an unknown job', (type, payload, message) => {
    expect(scene.precondition(scene.init(1), entry(type, payload))).toMatch(message);
  });

  it('refuses a stale attempt number', () => {
    const state = scene.apply(scene.init(1), { type: 'enqueue', payload: {} }, { t: 0 });
    expect(scene.precondition(state, entry('attemptResult', { job: 'job-1', attempt: 2, status: 200 }))).toMatch(/not the current/);
  });

  it('refuses a requeue of a job that is not dead', () => {
    const state = scene.apply(scene.init(1), { type: 'enqueue', payload: {} }, { t: 0 });
    expect(scene.precondition(state, entry('requeue', { job: 'job-1' }))).toMatch(/dead letter/);
  });

  it.each([
    ['setPolicy', { maxAttempts: 0, baseDelayMs: 100, jitterPercent: 0 }],
    ['setPolicy', { maxAttempts: 4, baseDelayMs: 1, jitterPercent: 0 }],
    ['setPolicy', { maxAttempts: 4, baseDelayMs: 100, jitterPercent: 500 }],
    ['setHealthy', { healthy: 'yes' }],
    ['attemptResult', { job: 'job-1' }],
  ])('rejects the payload of %s %o', (type, payload) => {
    expect(scene.parse(type, payload as never)).not.toBeNull();
  });
});

describe('serialization', () => {
  it('survives a round trip without its presentation field', () => {
    const state = scene.apply(scene.init(1), { type: 'enqueue', payload: {} }, { t: 5 });
    expect(state.presentation.pulse).toBe('job-1');
    const restored = scene.restore(JSON.parse(JSON.stringify(scene.serialize(state))), 1);
    expect(restored.presentation.pulse).toBeNull();
    expect(hashState(scene, restored)).toBe(hashState(scene, state));
  });
});
