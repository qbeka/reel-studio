import { type Split, formatCents, sharesFor, splitProblem } from './money';

export interface Member {
  id: string;
  name: string;
}

export interface LineItem {
  label: string;
  cents: number;
}

export interface Expense {
  id: string;
  merchant: string;
  date: string;
  totalCents: number;
  paidBy: string;
  items: LineItem[];
  split: Split;
}

export interface Draft {
  expenseId: string;
  split: Split;
}

export interface ReceiptState {
  members: Member[];
  expenses: Expense[];
  selectedId: string | null;
  draft: Draft | null;
  /** The error from the latest save attempt. Cleared by the next draft change. */
  validation: { code: string; message: string } | null;
  /** A save waiting for its outcome from the local fixture service. */
  pendingSave: { requestId: number; expenseId: string } | null;
  view: 'receipt' | 'balances';
  /** Net position per member in cents. Positive means the member is owed money. */
  balances: Record<string, number>;
  /** Balances if the draft were saved. Null when the draft is not valid. */
  preview: Record<string, number> | null;
  nextRequestId: number;
  nextExpenseNumber: number;
  /** Seeded generator state. See core/random.ts. */
  rng: number;
  /** Transient. Excluded from `serialize` and from state hashes. */
  presentation: { flash: string | null };
}

export const MEMBERS: Member[] = [
  { id: 'mina', name: 'Mina' },
  { id: 'theo', name: 'Theo' },
  { id: 'ana', name: 'Ana' },
];

const equal: Split = { mode: 'equal', values: {} };

/** Invented receipts. No row comes from a real person or a real account. */
export const STARTING_EXPENSES: Expense[] = [
  {
    id: 'e1',
    merchant: 'Corner Grocer',
    date: '2 Mar',
    totalCents: 6418,
    paidBy: 'mina',
    items: [
      { label: 'Produce', cents: 2240 },
      { label: 'Pantry', cents: 3178 },
      { label: 'Delivery', cents: 1000 },
    ],
    split: equal,
  },
  {
    id: 'e2',
    merchant: 'Harbor Noodle Bar',
    date: '4 Mar',
    totalCents: 8750,
    paidBy: 'theo',
    items: [
      { label: 'Noodles x3', cents: 5400 },
      { label: 'Shared plates', cents: 2200 },
      { label: 'Tip', cents: 1150 },
    ],
    split: equal,
  },
  {
    id: 'e3',
    merchant: 'Fernway Utilities',
    date: '7 Mar',
    totalCents: 11999,
    paidBy: 'ana',
    items: [
      { label: 'Electricity', cents: 8299 },
      { label: 'Water', cents: 3700 },
    ],
    split: { mode: 'percent', values: { mina: 5000, theo: 2500, ana: 2500 } },
  },
];

export function memberIds(state: Pick<ReceiptState, 'members'>): string[] {
  return state.members.map((m) => m.id);
}

/**
 * Net balances from the whole ledger. Deliberately recomputed from every expense rather
 * than patched, because a viewer sees this result after each draft change and it must
 * never drift from the ledger. Cost is O(expenses x members) per call.
 */
export function computeBalances(
  members: readonly Member[],
  expenses: readonly Expense[],
  override?: Draft | null,
): Record<string, number> {
  const ids = members.map((m) => m.id);
  const balances: Record<string, number> = {};
  for (const id of ids) balances[id] = 0;
  for (const expense of expenses) {
    const split = override?.expenseId === expense.id ? override.split : expense.split;
    const shares = sharesFor(expense.totalCents, split, ids);
    balances[expense.paidBy]! += expense.totalCents;
    shares.forEach((share, i) => {
      balances[ids[i]!]! -= share;
    });
  }
  return balances;
}

export function selectedExpense(state: ReceiptState): Expense | null {
  return state.expenses.find((e) => e.id === state.selectedId) ?? null;
}

/** Balances with the draft applied, or null if the draft cannot be saved yet. */
export function previewBalances(
  members: readonly Member[],
  expenses: readonly Expense[],
  draft: Draft | null,
): Record<string, number> | null {
  if (draft === null) return null;
  const expense = expenses.find((e) => e.id === draft.expenseId);
  if (expense === undefined) return null;
  const ids = members.map((m) => m.id);
  if (splitProblem(expense.totalCents, draft.split, ids) !== null) return null;
  return computeBalances(members, expenses, draft);
}

export function initialState(seed: number): ReceiptState {
  const expenses = STARTING_EXPENSES.map((e) => ({ ...e }));
  return {
    members: MEMBERS,
    expenses,
    selectedId: null,
    draft: null,
    validation: null,
    pendingSave: null,
    view: 'receipt',
    balances: computeBalances(MEMBERS, expenses),
    preview: null,
    nextRequestId: 1,
    nextExpenseNumber: expenses.length + 1,
    rng: seed | 0,
    presentation: { flash: null },
  };
}

export function balanceLine(state: ReceiptState, balances: Record<string, number>): string {
  return state.members
    .map((m) => {
      const value = balances[m.id] ?? 0;
      if (value === 0) return `${m.name} is settled`;
      return value > 0
        ? `${m.name} is owed ${formatCents(value)}`
        : `${m.name} owes ${formatCents(-value)}`;
    })
    .join(', ');
}
