/**
 * Seeded negative controls. Each one breaks the system in one specific way. A control
 * passes only if the named detector reports it, and the two groups show why both
 * detectors are needed:
 *
 * - Money bugs live in the reducer, so replay and seek share them and agree. Only the
 *   independent oracle can see them. `seekCheckBlind` records that the seek check missed
 *   each one, which is the case the oracle exists for.
 * - Seek bugs live in the timeline. The reducer is fine, so the oracle sees nothing and
 *   only a comparison with replay can find them.
 *
 * A control that goes undetected invalidates the correctness result.
 */
import type { AnyAdapter, LogEntry } from '../src/core/adapter';
import { type Cursor, Timeline } from '../src/core/timeline';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import { sharesFor } from '../src/scenes/receipt/money';
import { type ReceiptState, memberIds } from '../src/scenes/receipt/state';
import { auditReceipt } from './audit';
import { receiptLog } from './fixtures';
import { checkSeeking, fastHash, seekPositions } from './harness';

export interface ControlResult {
  id: string;
  group: 'money' | 'seek' | 'hash';
  description: string;
  detectedBy: string;
  detected: boolean;
  /** Money controls only: the seek check agreed with the bug, as expected. */
  seekCheckBlind?: boolean;
  detail: string;
}

const SEED = 31;
const INTERVAL = 32;

function balancesWith(
  state: ReceiptState,
  share: (total: number, split: ReceiptState['expenses'][number]['split'], ids: string[]) => number[],
  creditPayer: boolean,
): Record<string, number> {
  const ids = memberIds(state);
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const expense of state.expenses) {
    if (creditPayer) out[expense.paidBy]! += expense.totalCents;
    share(expense.totalCents, expense.split, ids).forEach((value, i) => {
      out[ids[i]!]! -= value;
    });
  }
  return out;
}

/** Replaces the balances the reducer stored. Everything else stays correct. */
function withBalances(
  compute: (state: ReceiptState) => Record<string, number>,
): AnyAdapter {
  return {
    ...receiptAdapter,
    apply(state, command, clock) {
      const next = receiptAdapter.apply(state, command, clock);
      return next.balances === state.balances ? next : { ...next, balances: compute(next) };
    },
  };
}

const moneyControls: { id: string; description: string; adapter: AnyAdapter }[] = [
  {
    id: 'dropped-cents',
    description: 'Shares round down and the leftover cents are lost.',
    adapter: withBalances((s) =>
      balancesWith(
        s,
        (total, split, ids) => {
          if (split.mode === 'amount') return sharesFor(total, split, ids);
          const weights = split.mode === 'equal' ? ids.map(() => 1) : ids.map((id) => split.values[id] ?? 0);
          const sum = weights.reduce((a, b) => a + b, 0);
          return weights.map((w) => Math.floor((total * w) / sum));
        },
        true,
      ),
    ),
  },
  {
    id: 'payer-not-credited',
    description: 'The person who paid is never credited.',
    adapter: withBalances((s) => balancesWith(s, sharesFor, false)),
  },
  {
    id: 'remainder-to-first',
    description: 'Leftover cents always go to the first member, not the largest remainder.',
    adapter: withBalances((s) =>
      balancesWith(
        s,
        (total, split, ids) => {
          if (split.mode !== 'percent') return sharesFor(total, split, ids);
          const shares = ids.map((id) => Math.floor((total * (split.values[id] ?? 0)) / 10000));
          shares[0]! += total - shares.reduce((a, b) => a + b, 0);
          return shares;
        },
        true,
      ),
    ),
  },
  {
    id: 'swallows-validation-error',
    description: 'A split that does not add up shows no error.',
    adapter: {
      ...receiptAdapter,
      apply(state: ReceiptState, command, clock) {
        const next = receiptAdapter.apply(state, command, clock);
        return command.type === 'confirmEdit' ? { ...next, validation: null } : next;
      },
    },
  },
  {
    id: 'save-ignores-draft',
    description: 'A confirmed save keeps the old split.',
    adapter: {
      ...receiptAdapter,
      apply(state: ReceiptState, command, clock) {
        const next = receiptAdapter.apply(state, command, clock);
        if (command.type !== 'saveResult' || command.payload.ok !== true) return next;
        return { ...next, expenses: state.expenses, balances: state.balances };
      },
    },
  },
  {
    id: 'rng-not-advanced',
    description: 'A new receipt reuses the same random draw as the last one.',
    adapter: {
      ...receiptAdapter,
      apply(state: ReceiptState, command, clock) {
        const next = receiptAdapter.apply(state, command, clock);
        return command.type === 'addReceipt' ? { ...next, rng: state.rng } : next;
      },
    },
  },
];

/** A timeline whose bug is chosen by a subclass, so production code stays untouched. */
class OffByOneTime extends Timeline {
  override countAt(time: number): number {
    // Uses `<` where the format says `<=`.
    let count = 0;
    while (count < this.log.length && this.log[count]!.t < time) count++;
    return count;
  }
}

class SkipsBoundaryCommand extends Timeline {
  override startFor(count: number): Cursor<any> {
    const cursor = super.startFor(count);
    // Resumes one command too late whenever it starts from a checkpoint.
    return cursor.count > 0 && cursor.count < count ? { ...cursor, count: cursor.count + 1 } : cursor;
  }
}

class StaleCheckpoint extends Timeline {
  private first: Cursor<any> | null = null;
  override startFor(count: number): Cursor<any> {
    const cursor = super.startFor(count);
    // Always resumes from the first checkpoint it ever saw, and labels it as current.
    if (cursor.count > 0) {
      this.first ??= { ...cursor };
      return { state: this.first.state, count: cursor.count };
    }
    return cursor;
  }
}

function reverseEqualTimes(log: readonly LogEntry[]): LogEntry[] {
  return [...log].sort((a, b) => a.t - b.t || b.seq - a.seq);
}

/** Mutates in place, so stored checkpoints alias the live state. */
const mutatingAdapter: AnyAdapter = {
  ...receiptAdapter,
  apply(state: ReceiptState, command, clock) {
    const next = receiptAdapter.apply(state, command, clock);
    Object.assign(state, next);
    return state;
  },
};

/** Reads a hidden counter, as a scene reading the wall clock would. */
function drifting(): AnyAdapter {
  let calls = 0;
  return {
    ...receiptAdapter,
    apply(state: ReceiptState, command, clock) {
      const next = receiptAdapter.apply(state, command, clock);
      return { ...next, nextRequestId: next.nextRequestId + (calls++ % 2) };
    },
    precondition: (state, command) =>
      command.type === 'saveResult' ? null : receiptAdapter.precondition(state, command),
  };
}

/** The stale seek scenario: a cold seek, then a newer one that finishes first. */
export async function staleSeekScenario(
  make: (timeline: Timeline, commits: number[], yieldToHost: () => Promise<void>) => { request(t: number): void },
): Promise<number[]> {
  const log = receiptLog({ commands: 400, expenses: 20, seed: SEED });
  const timeline = new Timeline(receiptAdapter, log, { seed: SEED, checkpointEvery: INTERVAL });
  const waiting: (() => void)[] = [];
  const commits: number[] = [];
  const controller = make(
    timeline,
    commits,
    () => new Promise<void>((resolve) => waiting.push(resolve)),
  );
  controller.request(log.at(-1)!.t);
  controller.request(log[5]!.t);
  while (waiting.length > 0) {
    for (const resume of waiting.splice(0)) resume();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return commits;
}

/** Commits every seek that finishes, with no check that it is still wanted. */
class NoTokenController {
  constructor(
    private readonly timeline: Timeline,
    private readonly commits: number[],
    private readonly yieldToHost: () => Promise<void>,
  ) {}
  request(time: number): void {
    const target = this.timeline.countAt(time);
    const cursor = this.timeline.startFor(target);
    void (async () => {
      while (!this.timeline.advance(cursor, target, 8)) await this.yieldToHost();
      this.commits.push(time);
    })();
  }
}

export async function runControls(): Promise<ControlResult[]> {
  const log = receiptLog({ commands: 1200, expenses: 40, seed: SEED });
  const positions = seekPositions(log, INTERVAL, 200, 3);
  const results: ControlResult[] = [];

  for (const control of moneyControls) {
    // The broken build records its own log, which is how a shared bug reaches a demo.
    const recorded = receiptLog({ commands: 1200, expenses: 40, seed: SEED, adapter: control.adapter });
    const problems = auditReceipt(control.adapter, recorded, SEED);
    const seek = checkSeeking(
      control.adapter,
      recorded,
      SEED,
      INTERVAL,
      seekPositions(recorded, INTERVAL, 200, 3),
    );
    results.push({
      id: control.id,
      group: 'money',
      description: control.description,
      detectedBy: 'oracle',
      detected: problems.length > 0,
      seekCheckBlind: seek.mismatches.length === 0,
      detail: `${problems.length} oracle problems, first: ${problems[0] ?? 'none'}. Seek check: ${seek.mismatches.length} mismatches.`,
    });
  }

  const seekControl = (
    id: string,
    description: string,
    mismatches: number,
  ): ControlResult => ({
    id,
    group: 'seek',
    description,
    detectedBy: 'seek check',
    detected: mismatches > 0,
    detail: `${mismatches} of ${positions.length} positions differ from replay.`,
  });

  const timelineOptions = { seed: SEED, checkpointEvery: INTERVAL };
  const run = (make: (a: AnyAdapter, l: readonly LogEntry[]) => Timeline) =>
    checkSeeking(receiptAdapter, log, SEED, INTERVAL, positions, make).mismatches.length;

  results.push(
    seekControl('off-by-one-time', 'A command exactly at the seek time is left out.', run((a, l) => new OffByOneTime(a, l, timelineOptions))),
    seekControl('skips-boundary', 'Resuming from a checkpoint skips one command.', run((a, l) => new SkipsBoundaryCommand(a, l, timelineOptions))),
    seekControl('stale-checkpoint', 'A seek resumes from an old checkpoint.', run((a, l) => new StaleCheckpoint(a, l, timelineOptions))),
    seekControl(
      'unstable-equal-times',
      'Commands with equal timestamps replay in a different order.',
      run((a, l) => new Timeline(a, reverseEqualTimes(l), timelineOptions)),
    ),
    seekControl(
      'mutating-reducer',
      'The reducer mutates state, so checkpoints change after they are stored.',
      checkSeeking(mutatingAdapter, log, SEED, INTERVAL, positions).mismatches.length,
    ),
    seekControl(
      'hidden-input',
      'The reducer reads a value outside the log, like a wall clock.',
      checkSeeking(drifting(), log, SEED, INTERVAL, positions).mismatches.length,
    ),
  );

  const stale = await staleSeekScenario((timeline, commits, yieldToHost) => new NoTokenController(timeline, commits, yieldToHost));
  results.push({
    id: 'stale-seek-commit',
    group: 'seek',
    description: 'An older seek overwrites a newer one when it finishes last.',
    detectedBy: 'latest-wins check',
    detected: stale.length !== 1,
    detail: `${stale.length} commits for 2 requests.`,
  });

  // A presentation field in the hash makes equal states look different.
  const leaky: AnyAdapter = {
    ...receiptAdapter,
    serialize: (state: ReceiptState) => state as never,
  };
  const state = receiptAdapter.apply(receiptAdapter.init(SEED), { type: 'selectExpense', payload: { id: 'e1' } }, { t: 0 });
  const restored = leaky.restore(JSON.parse(JSON.stringify(receiptAdapter.serialize(state))), 1);
  results.push({
    id: 'transient-in-hash',
    group: 'hash',
    description: 'A presentation field leaks into the state hash.',
    detectedBy: 'round trip check',
    detected: fastHash(leaky, state) !== fastHash(leaky, restored),
    detail: 'A serialize and restore round trip changed the hash.',
  });

  return results;
}
