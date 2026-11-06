/**
 * An independent model of the retry queue. It imports nothing from src. It predicts the
 * status of each job, how many attempts it has made and every chosen delay.
 */
import type { RawEntry } from './receipt-oracle';

type JobStatus = 'sending' | 'waiting' | 'delivered' | 'dead';

interface OracleJob {
  status: JobStatus;
  attempts: number;
  delays: number[];
  createdAt: number;
  nextAttemptAt: number | null;
}

const NEXT_STATUS: Record<string, readonly JobStatus[]> = {
  attemptResult: ['sending'],
  attemptDue: ['waiting'],
  requeue: ['dead'],
};

function mulberry(state: number): { value: number; state: number } {
  const MASK = 0xffffffffn;
  const next = (BigInt(state >>> 0) + 0x6d2b79f5n) & MASK;
  const imul = (a: bigint, b: bigint) => (a * b) & MASK;
  let z = imul(next ^ (next >> 15n), next | 1n);
  z = z ^ ((z + imul(z ^ (z >> 7n), z | 61n)) & MASK);
  const out = (z ^ (z >> 14n)) & MASK;
  return { value: Number(out) / 4294967296, state: Number(BigInt.asIntN(32, next)) };
}

export class RetryOracle {
  readonly jobs = new Map<string, OracleJob>();
  private maxAttempts = 4;
  private baseDelay = 400;
  private jitter = 25;
  private random: number;
  private count = 0;

  constructor(seed: number) {
    this.random = seed | 0;
  }

  step(entry: RawEntry): void {
    const { type, payload } = entry;
    const job = this.jobs.get(payload.job);
    const allowed = NEXT_STATUS[type];
    if (allowed !== undefined && (job === undefined || !allowed.includes(job.status))) {
      throw new Error(`Invalid transition: ${type} on ${payload.job} (seq ${entry.seq}).`);
    }
    switch (type) {
      case 'enqueue':
        this.jobs.set(`job-${++this.count}`, {
          status: 'sending',
          attempts: 0,
          delays: [],
          createdAt: entry.t,
          nextAttemptAt: null,
        });
        break;
      case 'setHealthy':
        break;
      case 'setPolicy':
        this.maxAttempts = payload.maxAttempts;
        this.baseDelay = payload.baseDelayMs;
        this.jitter = payload.jitterPercent;
        break;
      case 'attemptDue':
        job!.status = 'sending';
        job!.nextAttemptAt = null;
        break;
      case 'requeue':
        job!.status = 'sending';
        job!.attempts = 0;
        job!.delays = [];
        job!.nextAttemptAt = null;
        break;
      case 'attemptResult': {
        job!.attempts += 1;
        if (payload.status < 300) {
          job!.status = 'delivered';
        } else if (job!.attempts >= this.maxAttempts) {
          job!.status = 'dead';
        } else {
          const draw = mulberry(this.random);
          this.random = draw.state;
          // Integer arithmetic on scaled values, not the reducer's float expression.
          const exponential = this.baseDelay * 2 ** (job!.attempts - 1);
          const scaled = BigInt(exponential) * BigInt(Math.round(draw.value * 2 ** 32));
          const extra = (scaled * BigInt(this.jitter)) / (100n * 2n ** 32n);
          const delay = exponential + Number(extra);
          job!.delays.push(delay);
          job!.nextAttemptAt = entry.t + delay;
          job!.status = 'waiting';
        }
        break;
      }
      default:
        throw new Error(`Unknown command ${type}.`);
    }
  }
}
