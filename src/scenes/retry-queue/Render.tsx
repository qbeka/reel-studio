import type { SceneProps } from '../../core/adapter';
import type { Job, RetryState } from './state';

const STATUS_LABEL: Record<Job['status'], string> = {
  sending: 'Sending',
  waiting: 'Waiting to retry',
  delivered: 'Delivered',
  dead: 'Dead letter',
};

/** The most recent jobs. The stage has a fixed size, so a long queue is windowed. */
const JOB_WINDOW = 5;

/** Each attempt on a shared hairline, so the growing gaps show the backoff. */
function AttemptLine({ job, span }: { job: Job; span: number }) {
  const start = job.createdAt;
  const x = (t: number) => `${Math.min(100, ((t - start) / span) * 100)}%`;
  return (
    <div className="rq-line" aria-hidden="true">
      {job.attempts.map((attempt) => (
        <span key={attempt.n} className="rq-mark" data-ok={attempt.status < 300} style={{ left: x(attempt.t) }} />
      ))}
      {job.nextAttemptAt !== null && <span className="rq-next" style={{ left: x(job.nextAttemptAt) }} />}
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

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="rq-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= min && next <= max) onCommit(next);
        }}
      />
    </label>
  );
}

export function Render({ state, send, layout }: SceneProps<RetryState>) {
  const { policy } = state;
  const recent = state.jobs.slice(-JOB_WINDOW);
  const latest = recent.flatMap((job) => [
    ...job.attempts.map((a) => a.t - job.createdAt),
    (job.nextAttemptAt ?? job.createdAt) - job.createdAt,
  ]);
  const span = Math.max(1000, ...latest);
  const setPolicy = (patch: Partial<RetryState['policy']>) =>
    send('setPolicy', { ...policy, ...patch });

  return (
    <div className="rq" data-layout={layout}>
      <section className="rq-side" aria-label="Controls">
        <h2>Delivery queue</h2>
        <button type="button" className="rq-primary" data-reel-target="send" onClick={() => send('enqueue')}>
          Send an event
        </button>

        <fieldset className="rq-endpoint" data-reel-target="endpoint">
          <legend>Synthetic endpoint</legend>
          <label>
            <input
              type="radio"
              name="rq-endpoint"
              checked={!state.healthy}
              onChange={() => send('setHealthy', { healthy: false })}
            />
            Failing (503)
          </label>
          <label>
            <input
              type="radio"
              name="rq-endpoint"
              checked={state.healthy}
              onChange={() => send('setHealthy', { healthy: true })}
            />
            Healthy (200)
          </label>
        </fieldset>

        <div className="rq-policy" data-reel-target="policy">
          <NumberField
            label="Max attempts"
            value={policy.maxAttempts}
            min={1}
            max={8}
            onCommit={(maxAttempts) => setPolicy({ maxAttempts })}
          />
          <NumberField
            label="Base delay (ms)"
            value={policy.baseDelayMs}
            min={100}
            max={2000}
            onCommit={(baseDelayMs) => setPolicy({ baseDelayMs })}
          />
        </div>
      </section>

      <section className="rq-jobs" data-reel-target="jobs" aria-label="Jobs">
        {recent.length === 0 ? (
          <p className="rq-empty">Send an event to watch it retry</p>
        ) : (
          <ul>
            {recent.map((job) => (
              <li key={job.id} data-status={job.status} data-pulse={state.presentation.pulse === job.id}>
                <div className="rq-job-head">
                  <span>{job.label}</span>
                  <span className="rq-status">{STATUS_LABEL[job.status]}</span>
                </div>
                <AttemptLine job={job} span={span} />
                <p>{describeJob(job)}</p>
                {job.status === 'dead' && (
                  <button type="button" className="rq-quiet" onClick={() => send('requeue', { job: job.id })}>
                    Requeue {job.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {state.jobs.length > recent.length && (
          <p className="rq-foot">
            Showing {recent.length} of {state.jobs.length} jobs
          </p>
        )}
      </section>
    </div>
  );
}
