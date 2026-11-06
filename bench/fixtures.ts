/**
 * Seeded workloads for correctness runs and benchmarks. Every command goes through the
 * scene's own `parse` and `precondition`, so a fixture is a log the editor could have
 * recorded. These logs are generated, and the report labels them as synthetic.
 */
import type { AnyAdapter, Command, LogEntry } from '../src/core/adapter';
import { nextRandom } from '../src/core/random';
import { FORMAT, FORMAT_VERSION, type ReelProject } from '../src/core/project';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import type { ReceiptState } from '../src/scenes/receipt/state';
import { retryAdapter } from '../src/scenes/retry-queue/adapter';
import type { RetryState } from '../src/scenes/retry-queue/state';

class Dice {
  constructor(private rng: number) {}
  next(): number {
    const { value, rng } = nextRandom(this.rng);
    this.rng = rng;
    return value;
  }
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Applies commands through the scene's own rules and keeps the log. */
class Writer<S> {
  state: S;
  readonly log: LogEntry[] = [];
  t = 0;
  private seq = 1;

  constructor(
    private readonly adapter: AnyAdapter,
    seed: number,
    private readonly dice: Dice,
  ) {
    this.state = adapter.init(seed);
  }

  /** Human pauses between actions. Every 50th command shares its predecessor's time. */
  private step() {
    if (this.log.length % 50 !== 49) this.t += this.dice.int(180, 1400);
  }

  send(type: string, payload: Command['payload'] = {}, source: LogEntry['source'] = 'user') {
    this.step();
    const command = { type, payload };
    const problem = this.adapter.parse(type, payload) ?? this.adapter.precondition(this.state, command);
    if (problem !== null) throw new Error(`Fixture wrote an impossible ${type}: ${problem}`);
    const entry: LogEntry = { seq: this.seq++, t: this.t, type, payload, source };
    this.state = this.adapter.apply(this.state, entry, { t: entry.t });
    this.log.push(entry);
  }
}

export interface ReceiptFixtureOptions {
  commands: number;
  /** The ledger grows to about this many receipts over the first half of the log. */
  expenses: number;
  seed: number;
  /** The scene that records the log. Controls pass a broken one. */
  adapter?: AnyAdapter;
}

/**
 * A person working through a ledger: add receipts, open one, change the split, sometimes
 * get it wrong, fix it, save, look at balances. The mix is fixed by the seed.
 */
export function receiptLog({
  commands,
  expenses,
  seed,
  adapter = receiptAdapter,
}: ReceiptFixtureOptions): LogEntry[] {
  const dice = new Dice(seed ^ 0x51ed);
  const writer = new Writer<ReceiptState>(adapter, seed, dice);
  const members = ['mina', 'theo', 'ana'];
  const growUntil = commands / 2;

  while (writer.log.length < commands) {
    const count = writer.state.expenses.length;
    if (count < expenses && writer.log.length < growUntil) {
      const wanted = Math.ceil((expenses * (writer.log.length + 1)) / growUntil);
      for (let i = count; i < wanted && writer.log.length < commands; i++) writer.send('addReceipt');
    }
    if (writer.log.length >= commands) break;

    const expense = dice.pick(writer.state.expenses);
    writer.send('selectExpense', { id: expense.id });
    const mode = dice.pick(['percent', 'percent', 'percent', 'amount'] as const);
    if (writer.state.draft?.split.mode !== mode) writer.send('setSplitMode', { mode });

    const unit = mode === 'percent' ? 10000 : expense.totalCents;
    const a = dice.int(0, unit);
    const b = dice.int(0, unit - a);
    const correct = [a, b, unit - a - b];
    const wrong = dice.chance(0.3);
    if (wrong) {
      writer.send('setSplit', { member: members[0]!, value: correct[0]! + 1 });
      writer.send('setSplit', { member: members[1]!, value: correct[1]! });
      writer.send('setSplit', { member: members[2]!, value: correct[2]! });
      writer.send('confirmEdit');
      // Sometimes the person gives up and starts this receipt over.
      if (dice.chance(0.15)) {
        writer.send('cancelEdit');
        continue;
      }
    }
    for (const [i, member] of members.entries()) {
      if (writer.log.length >= commands - 2) break;
      writer.send('setSplit', { member, value: correct[i]! });
    }
    if (writer.log.length < commands - 1 && writer.state.draft !== null) {
      writer.send('confirmEdit');
      if (writer.log.length < commands && writer.state.pendingSave !== null) {
        const requestId = writer.state.pendingSave.requestId;
        writer.send('saveResult', { requestId, ok: !dice.chance(0.03) }, 'outcome');
      }
    }
    if (writer.log.length < commands && writer.state.pendingSave === null && dice.chance(0.25)) {
      writer.send('setView', { view: writer.state.view === 'receipt' ? 'balances' : 'receipt' });
    }
  }
  return writer.log.slice(0, commands);
}

/** A failing and recovering endpoint with policy changes. Real transitions only. */
export function retryLog({ commands, seed }: { commands: number; seed: number }): LogEntry[] {
  const dice = new Dice(seed ^ 0x7a11);
  const writer = new Writer<RetryState>(retryAdapter, seed, dice);
  while (writer.log.length < commands) {
    const state = writer.state;
    const sending = state.jobs.find((j) => j.status === 'sending');
    const waiting = state.jobs.find((j) => j.status === 'waiting');
    const dead = state.jobs.find((j) => j.status === 'dead');
    const roll = dice.next();
    if (sending !== undefined && roll < 0.6) {
      writer.send(
        'attemptResult',
        { job: sending.id, attempt: sending.attempts.length + 1, status: state.healthy ? 200 : 503 },
        'outcome',
      );
    } else if (waiting !== undefined && roll < 0.8) {
      writer.send('attemptDue', { job: waiting.id }, 'outcome');
    } else if (dead !== undefined && roll < 0.85) {
      writer.send('requeue', { job: dead.id });
    } else if (roll < 0.9) {
      writer.send('setHealthy', { healthy: !state.healthy });
    } else if (roll < 0.93) {
      writer.send('setPolicy', {
        maxAttempts: dice.int(2, 6),
        baseDelayMs: dice.int(100, 800),
        jitterPercent: dice.int(0, 50),
      });
    } else {
      writer.send('enqueue');
    }
  }
  return writer.log.slice(0, commands);
}

export function projectFrom(
  adapter: AnyAdapter,
  id: string,
  title: string,
  commands: LogEntry[],
  seed: number,
  checkpointEvery: number,
): ReelProject {
  const end = commands.at(-1)?.t ?? 0;
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id,
    title,
    disclosure: 'Synthetic benchmark data.',
    scene: { id: adapter.id, version: adapter.version },
    seed,
    checkpointEvery,
    trim: null,
    posterT: Math.floor(end / 2),
    commands,
    chapters: [0, 0.25, 0.5, 0.75].map((f, i) => ({
      id: `part-${i + 1}`,
      t: Math.floor(end * f),
      title: `Part ${i + 1}`,
    })),
    captions: [],
    camera: [],
  };
}

/** The declared workloads. Changing one changes every result, so they are listed here. */
export const WORKLOADS = {
  long: { commands: 2000, expenses: 120, seed: 20 },
  stress: { commands: 20000, expenses: 2000, seed: 21 },
} as const;
