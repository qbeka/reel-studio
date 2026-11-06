import type { Command, LogicalClock } from '../../core/adapter';
import { nextRandom } from '../../core/random';
import { type Split, type SplitMode, FULL_BPS, allocate, sharesFor, splitProblem } from './money';
import {
  type Draft,
  type Expense,
  type ReceiptState,
  computeBalances,
  memberIds,
  previewBalances,
} from './state';

/**
 * Each command recomputes balances over the ledger, so an unbounded ledger makes a log
 * cost quadratic time. This limit keeps every command, and so every file, bounded.
 */
export const MAX_RECEIPTS = 5000;

const NEW_RECEIPTS = [
  { merchant: 'Linden Bakery', items: ['Bread', 'Pastries'] },
  { merchant: 'Northline Transit', items: ['Passes', 'Top up'] },
  { merchant: 'Oak Street Hardware', items: ['Paint', 'Brushes'] },
  { merchant: 'Sable Coffee', items: ['Beans', 'Filters'] },
];

function withDraft(state: ReceiptState, draft: Draft | null, flash: string | null): ReceiptState {
  return {
    ...state,
    draft,
    validation: null,
    preview: previewBalances(state.members, state.expenses, draft),
    presentation: { flash },
  };
}

/** Converts the draft's current split to another mode without changing who pays what. */
function convertSplit(total: number, split: Split, ids: string[], mode: SplitMode): Split {
  if (mode === split.mode) return split;
  if (mode === 'equal') return { mode, values: {} };
  const valid = splitProblem(total, split, ids) === null;
  const shares = valid ? sharesFor(total, split, ids) : allocate(total, ids.map(() => 1));
  // Percentages are rounded to basis points with the same method, so they add to 100%.
  const values = mode === 'amount' ? shares : allocate(FULL_BPS, shares);
  return { mode, values: Object.fromEntries(ids.map((id, i) => [id, values[i]!])) };
}

export function precondition(state: ReceiptState, command: Command): string | null {
  const { type, payload } = command;
  if (state.pendingSave !== null && type !== 'saveResult' && type !== 'setView') {
    return 'A save is still in progress.';
  }
  switch (type) {
    case 'selectExpense':
      return state.expenses.some((e) => e.id === payload.id) ? null : 'That receipt does not exist.';
    case 'setSplitMode':
    case 'cancelEdit':
    case 'confirmEdit':
      return state.draft === null ? 'No receipt is open.' : null;
    case 'setSplit':
      if (state.draft === null) return 'No receipt is open.';
      if (state.draft.split.mode === 'equal') return 'An equal split has no shares to edit.';
      return state.members.some((m) => m.id === payload.member) ? null : 'Unknown member.';
    case 'saveResult':
      return state.pendingSave?.requestId === payload.requestId ? null : 'No save is waiting for this result.';
    case 'addReceipt':
      return state.expenses.length < MAX_RECEIPTS ? null : 'This ledger is full.';
    default:
      return null;
  }
}

export function apply(state: ReceiptState, command: Command, _clock: LogicalClock): ReceiptState {
  const { type, payload } = command;
  switch (type) {
    case 'selectExpense': {
      const expense = state.expenses.find((e) => e.id === payload.id)!;
      return {
        ...withDraft(state, { expenseId: expense.id, split: expense.split }, expense.id),
        selectedId: expense.id,
        view: 'receipt',
      };
    }
    case 'setSplitMode': {
      const draft = state.draft!;
      const expense = state.expenses.find((e) => e.id === draft.expenseId)!;
      const split = convertSplit(
        expense.totalCents,
        draft.split,
        memberIds(state),
        payload.mode as SplitMode,
      );
      return withDraft(state, { ...draft, split }, null);
    }
    case 'setSplit': {
      const draft = state.draft!;
      const member = payload.member as string;
      const values = { ...draft.split.values, [member]: payload.value as number };
      return withDraft(state, { ...draft, split: { ...draft.split, values } }, member);
    }
    case 'cancelEdit': {
      const draft = state.draft!;
      const expense = state.expenses.find((e) => e.id === draft.expenseId)!;
      return withDraft(state, { ...draft, split: expense.split }, null);
    }
    case 'confirmEdit': {
      const draft = state.draft!;
      const expense = state.expenses.find((e) => e.id === draft.expenseId)!;
      const problem = splitProblem(expense.totalCents, draft.split, memberIds(state));
      if (problem !== null) {
        return { ...state, validation: problem, presentation: { flash: null } };
      }
      return {
        ...state,
        validation: null,
        pendingSave: { requestId: state.nextRequestId, expenseId: expense.id },
        nextRequestId: state.nextRequestId + 1,
      };
    }
    case 'saveResult': {
      const pending = state.pendingSave!;
      if (payload.ok !== true) {
        return {
          ...state,
          pendingSave: null,
          validation: { code: 'save-failed', message: 'The save failed. Your draft is unchanged.' },
        };
      }
      const draft = state.draft!;
      const expenses = state.expenses.map((e) =>
        e.id === pending.expenseId ? { ...e, split: draft.split } : e,
      );
      return {
        ...state,
        expenses,
        pendingSave: null,
        balances: computeBalances(state.members, expenses),
        preview: previewBalances(state.members, expenses, draft),
        presentation: { flash: pending.expenseId },
      };
    }
    case 'setView':
      return { ...state, view: payload.view as ReceiptState['view'], presentation: { flash: null } };
    case 'addReceipt': {
      const pick = nextRandom(state.rng);
      const amount = nextRandom(pick.rng);
      const payer = nextRandom(amount.rng);
      const template = NEW_RECEIPTS[Math.floor(pick.value * NEW_RECEIPTS.length)]!;
      const totalCents = 1200 + Math.floor(amount.value * 12000);
      const first = Math.floor(totalCents * 0.6);
      const number = state.nextExpenseNumber;
      const expense: Expense = {
        id: `e${number}`,
        merchant: template.merchant,
        date: `${(number % 28) + 1} Apr`,
        totalCents,
        paidBy: state.members[Math.floor(payer.value * state.members.length)]!.id,
        items: [
          { label: template.items[0]!, cents: first },
          { label: template.items[1]!, cents: totalCents - first },
        ],
        split: { mode: 'equal', values: {} },
      };
      const expenses = [...state.expenses, expense];
      return {
        ...state,
        expenses,
        rng: payer.rng,
        nextExpenseNumber: number + 1,
        balances: computeBalances(state.members, expenses),
        preview: previewBalances(state.members, expenses, state.draft),
        presentation: { flash: expense.id },
      };
    }
    default:
      throw new Error(`Unhandled command ${type}`);
  }
}
