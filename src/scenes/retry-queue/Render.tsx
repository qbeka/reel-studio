import type { SceneProps } from '../../core/adapter';
import { type Job, type Policy, type RetryState, backoffMs } from './state';

/**
 * The visual layer of Relaymoth, the invented delivery console this scene demonstrates.
 * Everything here is drawn from the state it is given. Nothing reads a clock or keeps data
 * of its own, so a seek, a replay and a server render all show the same thing.
 */

const STATUS_LABEL: Record<Job['status'], string> = {
  sending: 'Sending',
  waiting: 'Waiting to retry',
  delivered: 'Delivered',
  dead: 'Dead letter',
};

/** The most recent jobs. The stage has a fixed size, so a long queue is windowed. */
const JOB_WINDOW = 4;

/** How many lines of the attempt log are kept on screen. */
const LOG_LINES = 5;

const LIMITS = { attempts: [1, 8], delay: [100, 2000] } as const;
const DELAY_STEP = 100;

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1).replace(/\.0$/, '')} s`;
}

/** The first thing known about a job on its line: its first answer, or the try it waits for. */
const originOf = (job: Job) => job.attempts[0]?.t ?? job.nextAttemptAt ?? job.createdAt;

/** How long a job's line runs, from its first answer to its last one or to its next try. */
function reach(job: Job): number {
  const end = Math.max(job.attempts.at(-1)?.t ?? job.createdAt, job.nextAttemptAt ?? 0);
  return Math.max(0, end - originOf(job));
}

/** Each attempt on a shared scale, so the growing gaps show the backoff. */
function AttemptLine({ job, span }: { job: Job; span: number }) {
  const origin = originOf(job);
  const x = (t: number) => `${Math.min(100, Math.max(0, ((t - origin) / span) * 100))}%`;
  const last = job.attempts.at(-1);
  const until = job.nextAttemptAt ?? last?.t ?? origin;
  return (
    <div className="rq-line" aria-hidden="true">
      <span className="rq-run" data-waiting={job.status === 'waiting'} style={{ width: x(until) }} />
      {job.attempts.map((attempt) => (
        <span key={attempt.n} className="rq-mark" data-ok={attempt.status < 300} style={{ left: x(attempt.t) }}>
          <i>{attempt.status}</i>
        </span>
      ))}
      {job.nextAttemptAt !== null && <span className="rq-next" style={{ left: x(job.nextAttemptAt) }} />}
      {job.status === 'sending' && (
        <span className="rq-flight" style={{ left: last === undefined ? '0%' : x(last.t + (last.delayMs ?? 0)) }} />
      )}
    </div>
  );
}

function describeJob(job: Job): string {
  const last = job.attempts.at(-1);
  if (last === undefined) return 'First attempt in flight';
  const tries = `${job.attempts.length} ${job.attempts.length === 1 ? 'attempt' : 'attempts'}`;
  if (job.status === 'waiting') return `${tries}, last got ${last.status}, waiting ${last.delayMs} ms`;
  if (job.status === 'sending') return `${tries}, retrying now`;
  if (job.status === 'delivered') return `Delivered after ${tries}`;
  return `Gave up after ${tries}, with last status ${last.status}`;
}

interface LogLine {
  key: string;
  t: number;
  label: string;
  n: number;
  status: number;
  next: string;
}

/**
 * The answers the endpoint gave, newest last. Only the jobs on screen are read, so the
 * log costs the same however long the queue is.
 */
function attemptLog(jobs: readonly Job[]): LogLine[] {
  const lines: LogLine[] = [];
  for (const job of jobs) {
    for (const attempt of job.attempts) {
      const final = attempt === job.attempts.at(-1);
      lines.push({
        key: `${job.id}:${attempt.n}:${attempt.t}`,
        t: attempt.t,
        label: job.id,
        n: attempt.n,
        status: attempt.status,
        next:
          attempt.status < 300
            ? 'delivered'
            : attempt.delayMs !== null
              ? `retry in ${duration(attempt.delayMs)}`
              : final && job.status === 'dead'
                ? 'dead letter'
                : 'gave up',
      });
    }
  }
  return lines.sort((a, b) => a.t - b.t).slice(-LOG_LINES);
}

function Stepper({
  label,
  shown,
  point,
  less,
  more,
  onLess,
  onMore,
}: {
  label: string;
  shown: string;
  point: string;
  less: boolean;
  more: boolean;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <div className="rq-field">
      <span aria-hidden="true">{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would draw its own box, and the group is named here. */}
      <div className="rq-stepper" role="group" aria-label={label}>
        <button
          type="button"
          aria-label={`Lower ${label.toLowerCase()}`}
          aria-disabled={!less}
          data-reel-point={`${point}:down`}
          onClick={() => {
            if (less) onLess();
          }}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <span className="rq-value">{shown}</span>
        <button
          type="button"
          aria-label={`Raise ${label.toLowerCase()}`}
          aria-disabled={!more}
          data-reel-point={`${point}:up`}
          onClick={() => {
            if (more) onMore();
          }}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M2.5 6h7M6 2.500v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** The waits a policy plans before each retry, without the random part. */
function Schedule({ policy }: { policy: Policy }) {
  const waits = Array.from({ length: policy.maxAttempts - 1 }, (_, i) => backoffMs(policy, i + 1, 0));
  const longest = Math.max(1, ...waits);
  return (
    <div className="rq-schedule">
      <p>
        {waits.length === 0
          ? 'One attempt and no retries'
          : `${waits.length} ${waits.length === 1 ? 'retry' : 'retries'}, each wait twice the last`}
      </p>
      <ol aria-hidden="true">
        {waits.map((wait, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one bar per retry, in order.
          <li key={i}>
            <i style={{ height: `${Math.max(6, (wait / longest) * 100)}%` }} />
            <span>{duration(wait)}</span>
          </li>
        ))}
      </ol>
      {waits.length > 0 && <p className="rq-range">Plus up to {policy.jitterPercent}% at random</p>}
    </div>
  );
}

function Brand() {
  return (
    <div className="rq-brand">
      <svg viewBox="0 0 22 22" width="22" height="22" fill="none" aria-hidden="true">
        <path d="M11 3.5v15M11 6.500 4 4v9l7 5.500M11 6.500 18 4v9l-7 5.500" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="11" cy="6.5" r="1.6" fill="currentColor" />
      </svg>
      <span>Relaymoth</span>
      <i>Sample data</i>
    </div>
  );
}

export function Render({ state, send, layout }: SceneProps<RetryState>) {
  const { policy } = state;
  const recent = state.jobs.slice(-JOB_WINDOW);
  const span = Math.max(1000, ...recent.map(reach)) * 1.06;
  const setPolicy = (patch: Partial<Policy>) => send('setPolicy', { ...policy, ...patch });
  // Counted over the whole queue, which a long log makes long, so it is one pass.
  let delivered = 0;
  let trying = 0;
  let dead = 0;
  for (const job of state.jobs) {
    if (job.status === 'delivered') delivered++;
    else if (job.status === 'dead') dead++;
    else trying++;
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const log = attemptLog(recent);

  return (
    <div className="rq" data-layout={layout}>
      <section className="rq-side" aria-label="Controls">
        <Brand />

        <button
          type="button"
          className="rq-primary"
          data-reel-target="send"
          data-reel-point="send"
          onClick={() => send('enqueue')}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M2.5 8h10M9 4.500 12.5 8 9 11.500" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Send an event
        </button>

        <fieldset className="rq-endpoint" data-reel-target="endpoint">
          <legend>Synthetic endpoint</legend>
          <p className="rq-url" data-healthy={state.healthy}>
            <i aria-hidden="true" />
            orders.example/hooks
          </p>
          <div className="rq-switch">
            <label data-active={!state.healthy} data-reel-point="health:false">
              <input
                type="radio"
                name="rq-endpoint"
                checked={!state.healthy}
                onChange={() => send('setHealthy', { healthy: false })}
              />
              Failing (503)
            </label>
            <label data-active={state.healthy} data-reel-point="health:true">
              <input
                type="radio"
                name="rq-endpoint"
                checked={state.healthy}
                onChange={() => send('setHealthy', { healthy: true })}
              />
              Healthy (200)
            </label>
          </div>
        </fieldset>

        <div className="rq-policy" data-reel-target="policy">
          <h3>Retry policy</h3>
          <Stepper
            label="Max attempts"
            shown={String(policy.maxAttempts)}
            point="attempts"
            less={policy.maxAttempts > LIMITS.attempts[0]}
            more={policy.maxAttempts < LIMITS.attempts[1]}
            onLess={() => setPolicy({ maxAttempts: policy.maxAttempts - 1 })}
            onMore={() => setPolicy({ maxAttempts: policy.maxAttempts + 1 })}
          />
          <Stepper
            label="Base delay"
            shown={`${policy.baseDelayMs} ms`}
            point="delay"
            less={policy.baseDelayMs - DELAY_STEP >= LIMITS.delay[0]}
            more={policy.baseDelayMs + DELAY_STEP <= LIMITS.delay[1]}
            onLess={() => setPolicy({ baseDelayMs: policy.baseDelayMs - DELAY_STEP })}
            onMore={() => setPolicy({ baseDelayMs: policy.baseDelayMs + DELAY_STEP })}
          />
          <Schedule policy={policy} />
        </div>

      </section>

      <section className="rq-jobs" data-reel-target="jobs" aria-label="Jobs">
        <header className="rq-head">
          <h2>Deliveries</h2>
          <ul className="rq-counts">
            <li data-kind="delivered">
              <b>{delivered}</b> delivered
            </li>
            <li data-kind="trying">
              <b>{trying}</b> in flight
            </li>
            <li data-kind="dead">
              <b>{dead}</b> dead
            </li>
          </ul>
        </header>

        {recent.length === 0 ? (
          <div className="rq-empty">
            <svg viewBox="0 0 120 44" width="120" height="44" fill="none" aria-hidden="true">
              <path d="M4 22h112" stroke="currentColor" strokeWidth="1" strokeDasharray="2 5" />
              <circle cx="14" cy="22" r="4" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="40" cy="22" r="4" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="88" cy="22" r="4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <p>Send an event to watch it retry</p>
          </div>
        ) : (
          <>
            <div className="rq-axis" aria-hidden="true">
              <span>Since the first answer</span>
              <ol>
                {ticks.map((tick) => (
                  <li key={tick} style={{ left: `${tick * 100}%` }}>
                    {duration(Math.round((span * tick) / 10) * 10)}
                  </li>
                ))}
              </ol>
            </div>
            <ul className="rq-list">
              {recent.map((job) => (
                <li key={job.id} data-status={job.status} data-pulse={state.presentation.pulse === job.id}>
                  <div className="rq-job-head">
                    <span className="rq-name">{job.label}</span>
                    <span className="rq-kind">order.created</span>
                  </div>
                  <AttemptLine job={job} span={span} />
                  <div className="rq-action" data-reel-point={`requeue:${job.id}`}>
                    {job.status === 'dead' ? (
                      <button type="button" className="rq-quiet" onClick={() => send('requeue', { job: job.id })}>
                        Requeue {job.label}
                      </button>
                    ) : (
                      <span className="rq-status">{STATUS_LABEL[job.status]}</span>
                    )}
                  </div>
                  <p>{describeJob(job)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        {state.jobs.length > recent.length && (
          <p className="rq-foot">
            Showing {recent.length} of {state.jobs.length} jobs
          </p>
        )}
        {log.length > 0 && (
          <div className="rq-log">
            <h3>Attempt log</h3>
            <ol>
              {log.map((line) => (
                <li key={line.key} data-ok={line.status < 300}>
                  <time>{(line.t / 1000).toFixed(2)} s</time>
                  <span>POST /hooks</span>
                  <span>
                    {line.label}, try {line.n}
                  </span>
                  <b>{line.status}</b>
                  <span>{line.next}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
