import type { Command, LogicalClock } from '../../core/adapter';
import { nextRandom } from '../../core/random';

export type JobStatus = 'sending' | 'waiting' | 'delivered' | 'dead';

export interface Attempt {
  n: number;
  /** Logical time the attempt finished. */
  t: number;
  /** HTTP status the synthetic endpoint returned. */
  status: number;
  /** Delay chosen before the next attempt, or null if there is none. */
  delayMs: number | null;
}

export interface Job {
  id: string;
  label: string;
  status: JobStatus;
  /** Logical time the job entered the queue. */
  createdAt: number;
  attempts: Attempt[];
  /** Logical time of the next attempt while the job is waiting. */
  nextAttemptAt: number | null;
}

export interface Policy {
  maxAttempts: number;
  baseDelayMs: number;
  /** Up to this percentage of the delay is added at random, to spread out retries. */
  jitterPercent: number;
}

export interface RetryState {
  policy: Policy;
  healthy: boolean;
  jobs: Job[];
  nextJob: number;
  /** Seeded generator state. See core/random.ts. */
  rng: number;
  /** Transient. Excluded from `serialize` and from state hashes. */
  presentation: { pulse: string | null };
}

export function initialState(seed: number): RetryState {
  return {
    policy: { maxAttempts: 4, baseDelayMs: 400, jitterPercent: 25 },
    healthy: false,
    jobs: [],
    nextJob: 1,
    rng: seed | 0,
    presentation: { pulse: null },
  };
}

/**
 * Exponential backoff with additive jitter. The n-th retry waits
 * base * 2^(n - 1) * (1 + u * jitter), with u in [0, 1) drawn from the seeded generator.
 * Rounded down to whole milliseconds, since logical time is integral.
 */
export function backoffMs(policy: Policy, attemptsMade: number, u: number): number {
  const exponential = policy.baseDelayMs * 2 ** (attemptsMade - 1);
  return Math.floor(exponential * (1 + (u * policy.jitterPercent) / 100));
}

export function precondition(state: RetryState, command: Command): string | null {
  const { type, payload } = command;
  const job = state.jobs.find((j) => j.id === payload.job);
  switch (type) {
    case 'attemptResult':
      if (job === undefined) return 'That job does not exist.';
      if (job.status !== 'sending') return 'That job has no attempt in flight.';
      return payload.attempt === job.attempts.length + 1 ? null : 'That is not the current attempt.';
    case 'attemptDue':
      if (job === undefined) return 'That job does not exist.';
      return job.status === 'waiting' ? null : 'That job is not waiting for a retry.';
    case 'requeue':
      if (job === undefined) return 'That job does not exist.';
      return job.status === 'dead' ? null : 'Only a dead letter can be requeued.';
    default:
      return null;
  }
}

function replaceJob(state: RetryState, job: Job): Job[] {
  return state.jobs.map((j) => (j.id === job.id ? job : j));
}

export function apply(state: RetryState, command: Command, clock: LogicalClock): RetryState {
  const { type, payload } = command;
  switch (type) {
    case 'enqueue': {
      const id = `job-${state.nextJob}`;
      const job: Job = {
        id,
        label: `Event ${state.nextJob}`,
        status: 'sending',
        createdAt: clock.t,
        attempts: [],
        nextAttemptAt: null,
      };
      return {
        ...state,
        jobs: [...state.jobs, job],
        nextJob: state.nextJob + 1,
        presentation: { pulse: id },
      };
    }
    case 'setHealthy':
      return { ...state, healthy: payload.healthy as boolean, presentation: { pulse: null } };
    case 'setPolicy':
      return {
        ...state,
        policy: {
          maxAttempts: payload.maxAttempts as number,
          baseDelayMs: payload.baseDelayMs as number,
          jitterPercent: payload.jitterPercent as number,
        },
        presentation: { pulse: null },
      };
    case 'attemptResult': {
      const job = state.jobs.find((j) => j.id === payload.job)!;
      const status = payload.status as number;
      const made = job.attempts.length + 1;
      const pulse = { pulse: job.id };
      if (status < 300) {
        const attempts = [...job.attempts, { n: made, t: clock.t, status, delayMs: null }];
        const done: Job = { ...job, status: 'delivered', attempts, nextAttemptAt: null };
        return { ...state, jobs: replaceJob(state, done), presentation: pulse };
      }
      if (made >= state.policy.maxAttempts) {
        const attempts = [...job.attempts, { n: made, t: clock.t, status, delayMs: null }];
        const dead: Job = { ...job, status: 'dead', attempts, nextAttemptAt: null };
        return { ...state, jobs: replaceJob(state, dead), presentation: pulse };
      }
      const draw = nextRandom(state.rng);
      const delayMs = backoffMs(state.policy, made, draw.value);
      const attempts = [...job.attempts, { n: made, t: clock.t, status, delayMs }];
      const waiting: Job = { ...job, status: 'waiting', attempts, nextAttemptAt: clock.t + delayMs };
      return { ...state, jobs: replaceJob(state, waiting), rng: draw.rng, presentation: pulse };
    }
    case 'attemptDue': {
      const job = state.jobs.find((j) => j.id === payload.job)!;
      const sending: Job = { ...job, status: 'sending', nextAttemptAt: null };
      return { ...state, jobs: replaceJob(state, sending), presentation: { pulse: job.id } };
    }
    case 'requeue': {
      const job = state.jobs.find((j) => j.id === payload.job)!;
      const sending: Job = { ...job, status: 'sending', attempts: [], nextAttemptAt: null };
      return { ...state, jobs: replaceJob(state, sending), presentation: { pulse: job.id } };
    }
    default:
      throw new Error(`Unhandled command ${type}`);
  }
}
