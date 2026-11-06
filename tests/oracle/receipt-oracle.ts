/**
 * An independent model of the receipt scene. This file imports nothing from src. It reads
 * the same log and predicts the money, so a bug shared by the reducer and the checkpoint
 * code cannot pass by agreeing with itself.
 *
 * It differs from the reducer on purpose:
 * - Exact rational arithmetic with BigInt, where the reducer uses JavaScript numbers.
 * - Balances are accumulated per expense share, not recomputed from a shared helper.
 * - Its random generator is written from the Mulberry32 definition, also in BigInt.
 * - Valid transitions are a table over an explicit status, not scattered preconditions.
 */

export interface RawEntry {
  seq: number;
  t: number;
  type: string;
  payload: Record<string, any>;
}

export interface Prediction {
  balances: Record<string, number>;
  /** Per expense, the cents each member owes. */
  shares: Record<string, Record<string, number>>;
  status: Status;
  error: string | null;
  selected: string | null;
  view: string;
  expenseCount: number;
  /** The open split, or null. */
  draft: Split | null;
  /** Balances if the draft were saved, or null when it cannot be saved. */
  preview: Record<string, number> | null;
}

type Status = 'idle' | 'editing' | 'saving';

export interface Split {
  mode: string;
  values: Record<string, number>;
}

interface OracleExpense {
  id: string;
  total: bigint;
  payer: string;
  split: Split;
}

const MEMBERS = ['mina', 'theo', 'ana'];

/** Commands each status may accept. The test suite treats anything else as a violation. */
const ALLOWED: Record<Status, readonly string[]> = {
  idle: ['selectExpense', 'setView', 'addReceipt'],
  editing: ['selectExpense', 'setSplitMode', 'setSplit', 'confirmEdit', 'cancelEdit', 'setView', 'addReceipt'],
  saving: ['saveResult', 'setView'],
};

/** Mulberry32, written from its definition with 32-bit arithmetic made explicit. */
function mulberry(state: number): { value: number; state: number } {
  const MASK = 0xffffffffn;
  const toU32 = (x: bigint) => x & MASK;
  const next = toU32(BigInt(state >>> 0) + 0x6d2b79f5n);
  const imul = (a: bigint, b: bigint) => toU32(a * b);
  let z = imul(next ^ (next >> 15n), next | 1n);
  z = z ^ toU32(z + imul(z ^ (z >> 7n), z | 61n));
  const out = (z ^ (z >> 14n)) & MASK;
  return { value: Number(out) / 4294967296, state: Number(BigInt.asIntN(32, next)) };
}

/** Largest remainder with exact fractions. Ties go to the lower index. */
function exactAllocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  const whole = weights.map((w) => (total * w) / sum);
  const remainder = weights.map((w, i) => total * w - whole[i]! * sum);
  let left = total - whole.reduce((a, b) => a + b, 0n);
  const indexes = weights.map((_, i) => i);
  indexes.sort((x, y) => {
    if (remainder[x]! === remainder[y]!) return x - y;
    return remainder[x]! > remainder[y]! ? -1 : 1;
  });
  for (const i of indexes) {
    if (left === 0n) break;
    whole[i]! += 1n;
    whole[i] = whole[i]!;
    left -= 1n;
  }
  return whole;
}

function sharesOf(expense: OracleExpense, split: Split): bigint[] {
  if (split.mode === 'equal') return exactAllocate(expense.total, MEMBERS.map(() => 1n));
  const values = MEMBERS.map((m) => BigInt(split.values[m] ?? 0));
  return split.mode === 'percent' ? exactAllocate(expense.total, values) : values;
}

function splitIsValid(expense: OracleExpense, split: Split): boolean {
  if (split.mode === 'equal') return true;
  const sum = MEMBERS.reduce((total, m) => total + BigInt(split.values[m] ?? 0), 0n);
  return sum === (split.mode === 'percent' ? 10000n : expense.total);
}

export class ReceiptOracle {
  private expenses: OracleExpense[] = [
    { id: 'e1', total: 6418n, payer: 'mina', split: { mode: 'equal', values: {} } },
    { id: 'e2', total: 8750n, payer: 'theo', split: { mode: 'equal', values: {} } },
    { id: 'e3', total: 11999n, payer: 'ana', split: { mode: 'percent', values: { mina: 5000, theo: 2500, ana: 2500 } } },
  ];
  private status: Status = 'idle';
  private selected: string | null = null;
  private draft: Split | null = null;
  private error: string | null = null;
  private view = 'receipt';
  private savingId: string | null = null;
  private nextRequest = 1;
  private nextExpense = 4;
  private random: number;

  constructor(seed: number) {
    this.random = seed | 0;
  }

  /** Applies one entry. Throws if the entry is an invalid transition. */
  step(entry: RawEntry): void {
    if (!ALLOWED[this.status].includes(entry.type)) {
      throw new Error(`Invalid transition: ${entry.type} while ${this.status} (seq ${entry.seq}).`);
    }
    const expense = this.expenses.find((e) => e.id === this.selected);
    switch (entry.type) {
      case 'selectExpense': {
        const found = this.expenses.find((e) => e.id === entry.payload.id);
        if (found === undefined) throw new Error(`Unknown expense in seq ${entry.seq}.`);
        this.selected = found.id;
        this.draft = { mode: found.split.mode, values: { ...found.split.values } };
        this.error = null;
        this.status = 'editing';
        this.view = 'receipt';
        break;
      }
      case 'setSplitMode':
        this.convert(expense!, entry.payload.mode);
        this.error = null;
        break;
      case 'setSplit':
        if (this.draft!.mode === 'equal') throw new Error(`setSplit on an equal split, seq ${entry.seq}.`);
        this.draft!.values[entry.payload.member] = entry.payload.value;
        this.error = null;
        break;
      case 'cancelEdit':
        this.draft = { mode: expense!.split.mode, values: { ...expense!.split.values } };
        this.error = null;
        break;
      case 'confirmEdit':
        if (splitIsValid(expense!, this.draft!)) {
          this.savingId = expense!.id;
          this.nextRequest++;
          this.status = 'saving';
          this.error = null;
        } else {
          this.error = this.draft!.mode === 'percent' ? 'percent-total' : 'amount-total';
        }
        break;
      case 'saveResult':
        if (entry.payload.requestId !== this.nextRequest - 1) {
          throw new Error(`Save result for the wrong request, seq ${entry.seq}.`);
        }
        if (entry.payload.ok === true) {
          const saved = this.expenses.find((e) => e.id === this.savingId)!;
          saved.split = { mode: this.draft!.mode, values: { ...this.draft!.values } };
        } else {
          this.error = 'save-failed';
        }
        this.savingId = null;
        this.status = 'editing';
        break;
      case 'setView':
        this.view = entry.payload.view;
        break;
      case 'addReceipt': {
        const pick = mulberry(this.random);
        const amount = mulberry(pick.state);
        const payer = mulberry(amount.state);
        this.random = payer.state;
        this.expenses.push({
          id: `e${this.nextExpense++}`,
          total: 1200n + BigInt(Math.floor(amount.value * 12000)),
          payer: MEMBERS[Math.floor(payer.value * MEMBERS.length)]!,
          split: { mode: 'equal', values: {} },
        });
        break;
      }
      default:
        throw new Error(`Unknown command ${entry.type}.`);
    }
  }

  private convert(expense: OracleExpense, mode: string): void {
    const draft = this.draft!;
    if (mode === draft.mode) return;
    if (mode === 'equal') {
      this.draft = { mode, values: {} };
      return;
    }
    const shares = splitIsValid(expense, draft)
      ? sharesOf(expense, draft)
      : exactAllocate(expense.total, MEMBERS.map(() => 1n));
    const values = mode === 'amount' ? shares : exactAllocate(10000n, shares);
    this.draft = {
      mode,
      values: Object.fromEntries(MEMBERS.map((m, i) => [m, Number(values[i]!)])),
    };
  }

  /** Net positions with `draft` standing in for the split of the selected expense. */
  private ledger(draft: Split | null) {
    const totals = new Map(MEMBERS.map((m) => [m, 0n]));
    const shares: Prediction['shares'] = {};
    for (const expense of this.expenses) {
      const split = draft !== null && expense.id === this.selected ? draft : expense.split;
      const owed = sharesOf(expense, split);
      const sum = owed.reduce((a, b) => a + b, 0n);
      if (sum !== expense.total) throw new Error(`Shares of ${expense.id} do not add up.`);
      totals.set(expense.payer, totals.get(expense.payer)! + expense.total);
      shares[expense.id] = {};
      MEMBERS.forEach((m, i) => {
        totals.set(m, totals.get(m)! - owed[i]!);
        shares[expense.id]![m] = Number(owed[i]!);
      });
    }
    const net = [...totals.values()].reduce((a, b) => a + b, 0n);
    if (net !== 0n) throw new Error('Balances do not sum to zero.');
    return { balances: Object.fromEntries([...totals].map(([m, v]) => [m, Number(v)])), shares };
  }

  predict(): Prediction {
    const { balances, shares } = this.ledger(null);
    const open = this.expenses.find((e) => e.id === this.selected);
    const canPreview = this.draft !== null && open !== undefined && splitIsValid(open, this.draft);
    return {
      balances,
      shares,
      draft: this.draft,
      preview: canPreview ? this.ledger(this.draft).balances : null,
      status: this.status,
      error: this.error,
      selected: this.selected,
      view: this.view,
      expenseCount: this.expenses.length,
    };
  }
}
