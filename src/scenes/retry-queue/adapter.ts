import type { Command, Effect, Payload, SceneAdapter } from '../../core/adapter';
import type { Json } from '../../core/canonical';
import { Render } from './Render';
import { type RetryState, apply, initialState, precondition } from './state';

/** How long the synthetic endpoint takes to answer. */
export const ATTEMPT_MS = 260;

function parse(type: string, payload: Payload): string | null {
  switch (type) {
    case 'setHealthy':
      return typeof payload.healthy === 'boolean' ? null : 'setHealthy needs true or false.';
    case 'setPolicy': {
      const { maxAttempts, baseDelayMs, jitterPercent } = payload;
      const whole = (v: unknown, low: number, high: number) =>
        Number.isInteger(v) && (v as number) >= low && (v as number) <= high;
      return whole(maxAttempts, 1, 8) && whole(baseDelayMs, 100, 2000) && whole(jitterPercent, 0, 100)
        ? null
        : 'setPolicy needs maxAttempts 1 to 8, baseDelayMs 100 to 2000 and jitterPercent 0 to 100.';
    }
    case 'attemptResult': {
      const { job, attempt, status } = payload;
      return typeof job === 'string' && Number.isInteger(attempt) && Number.isInteger(status)
        ? null
        : 'attemptResult needs a job, an attempt number and a status.';
    }
    case 'attemptDue':
    case 'requeue':
      return typeof payload.job === 'string' ? null : `${type} needs a job.`;
    default:
      return null;
  }
}

/** The fixture endpoint answers by the state's health flag. Nothing leaves this machine. */
function attemptEffect(state: RetryState, jobId: string): Effect {
  const job = state.jobs.find((j) => j.id === jobId)!;
  return {
    delayMs: ATTEMPT_MS,
    command: {
      type: 'attemptResult',
      payload: { job: jobId, attempt: job.attempts.length + 1, status: state.healthy ? 200 : 503 },
    },
  };
}

function effects(state: RetryState, command: Command): readonly Effect[] {
  switch (command.type) {
    case 'enqueue':
      return [attemptEffect(state, state.jobs.at(-1)!.id)];
    case 'attemptDue':
    case 'requeue':
      return [attemptEffect(state, command.payload.job as string)];
    case 'attemptResult': {
      const job = state.jobs.find((j) => j.id === command.payload.job)!;
      if (job.status !== 'waiting') return [];
      return [
        {
          delayMs: job.attempts.at(-1)!.delayMs!,
          command: { type: 'attemptDue', payload: { job: job.id } },
        },
      ];
    }
    default:
      return [];
  }
}

function describe(_before: RetryState, command: Command, after: RetryState): string | null {
  const job = after.jobs.find((j) => j.id === command.payload.job);
  switch (command.type) {
    case 'enqueue':
      return `Sent ${after.jobs.at(-1)!.label}`;
    case 'setHealthy':
      return command.payload.healthy ? 'The endpoint recovered' : 'The endpoint started failing';
    case 'setPolicy':
      return `Changed the policy to ${after.policy.maxAttempts} attempts with a base delay of ${after.policy.baseDelayMs} ms`;
    case 'attemptResult': {
      const attempt = job!.attempts.at(-1)!;
      if (job!.status === 'delivered') return `${job!.label} was delivered on attempt ${attempt.n}`;
      if (job!.status === 'dead') {
        return `${job!.label} failed attempt ${attempt.n} with ${attempt.status} and moved to dead letters`;
      }
      return `${job!.label} failed attempt ${attempt.n} with ${attempt.status}, and the next try is in ${attempt.delayMs} ms`;
    }
    case 'requeue':
      return `Requeued ${job!.label}`;
    default:
      return null;
  }
}

function serialize(state: RetryState): Json {
  const { presentation: _presentation, ...data } = state;
  return data as unknown as Json;
}

export const retryAdapter: SceneAdapter<RetryState> = {
  id: 'retry-queue',
  version: 1,
  title: 'Retry queue',
  summary: 'Send events to a failing synthetic endpoint and watch backoff, recovery and dead letters.',
  commandTypes: ['enqueue', 'setHealthy', 'setPolicy', 'attemptResult', 'attemptDue', 'requeue'],
  targets: [
    { id: 'send', label: 'Send button' },
    { id: 'endpoint', label: 'Endpoint switch' },
    { id: 'policy', label: 'Retry policy' },
    { id: 'jobs', label: 'Job list' },
  ],
  layouts: {
    wide: { width: 880, height: 560 },
    narrow: { width: 360, height: 580 },
  },
  init: initialState,
  parse,
  precondition,
  apply,
  effects,
  pendingEffects(state, t) {
    return state.jobs.flatMap((job): Effect[] => {
      if (job.status === 'sending') return [attemptEffect(state, job.id)];
      if (job.status !== 'waiting') return [];
      return [
        {
          delayMs: Math.max(0, job.nextAttemptAt! - t),
          command: { type: 'attemptDue', payload: { job: job.id } },
        },
      ];
    });
  },
  serialize,
  restore(json) {
    return { ...(json as unknown as Omit<RetryState, 'presentation'>), presentation: { pulse: null } };
  },
  describe,
  targetOf(command) {
    switch (command.type) {
      case 'enqueue':
        return 'send';
      case 'setHealthy':
        return 'endpoint';
      case 'setPolicy':
        return 'policy';
      default:
        return 'jobs';
    }
  },
  Render,
};
