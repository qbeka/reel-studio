/**
 * Compares a scene with its independent oracle after every command. It returns the
 * problems found, so an empty list means full agreement over the whole log.
 */
import type { AnyAdapter, LogEntry } from '../src/core/adapter';
import { sharesFor } from '../src/scenes/receipt/money';
import type { ReceiptState } from '../src/scenes/receipt/state';
import type { RetryState } from '../src/scenes/retry-queue/state';
import { ReceiptOracle } from '../tests/oracle/receipt-oracle';
import { RetryOracle } from '../tests/oracle/retry-oracle';

/** Replays a log, comparing the scene with the oracle after every command. */
export function auditReceipt(
  adapter: AnyAdapter,
  log: readonly LogEntry[],
  seed: number,
  /** The oracle steps through every command and compares after every Nth one. */
  compareEvery = 1,
): string[] {
  const problems: string[] = [];
  const oracle = new ReceiptOracle(seed);
  let state: ReceiptState = adapter.init(seed);
  for (const entry of log) {
    try {
      oracle.step(entry);
      state = adapter.apply(state, entry, { t: entry.t });
      if (entry.seq % compareEvery !== 0) continue;
      const expected = oracle.predict();
      const ids = state.members.map((m) => m.id);
      if (JSON.stringify(sorted(state.balances)) !== JSON.stringify(sorted(expected.balances))) {
        problems.push(`seq ${entry.seq}: balances differ`);
      }
      for (const expense of state.expenses) {
        const shares = sharesFor(expense.totalCents, expense.split, ids);
        const want = ids.map((id) => expected.shares[expense.id]?.[id]);
        if (JSON.stringify(shares) !== JSON.stringify(want)) {
          problems.push(`seq ${entry.seq}: shares of ${expense.id} differ`);
        }
      }
      if (state.expenses.length !== expected.expenseCount) problems.push(`seq ${entry.seq}: receipt count differs`);
      if ((state.validation?.code ?? null) !== expected.error) problems.push(`seq ${entry.seq}: validation differs`);
      if (state.selectedId !== expected.selected) problems.push(`seq ${entry.seq}: selection differs`);
      if (state.view !== expected.view) problems.push(`seq ${entry.seq}: view differs`);
      const status = state.pendingSave !== null ? 'saving' : state.draft !== null ? 'editing' : 'idle';
      if (status !== expected.status) problems.push(`seq ${entry.seq}: status differs`);
    } catch (error) {
      problems.push(String((error as Error).message));
      break;
    }
  }
  return problems;
}

const sorted = (record: Record<string, number>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));

export function auditRetry(adapter: AnyAdapter, log: readonly LogEntry[], seed: number): string[] {
  const problems: string[] = [];
  const oracle = new RetryOracle(seed);
  let state: RetryState = adapter.init(seed);
  for (const entry of log) {
    try {
      oracle.step(entry);
      state = adapter.apply(state, entry, { t: entry.t });
      for (const job of state.jobs) {
        const expected = oracle.jobs.get(job.id);
        if (expected?.status !== job.status) problems.push(`seq ${entry.seq}: ${job.id} status differs`);
        if (expected?.attempts !== job.attempts.length) problems.push(`seq ${entry.seq}: ${job.id} attempts differ`);
        const delays = job.attempts.flatMap((a) => (a.delayMs === null ? [] : [a.delayMs]));
        if (JSON.stringify(delays) !== JSON.stringify(expected?.delays)) {
          problems.push(`seq ${entry.seq}: ${job.id} delays differ`);
        }
      }
    } catch (error) {
      problems.push(String((error as Error).message));
      break;
    }
  }
  return problems;
}
