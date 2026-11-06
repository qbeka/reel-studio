import type { Command, Effect, Payload, SceneAdapter } from '../../core/adapter';
import type { Json } from '../../core/canonical';
import { Render } from './Render';
import { formatCents, formatPercent, sharesFor } from './money';
import { apply, precondition } from './reduce';
import { type ReceiptState, balanceLine, initialState, memberIds } from './state';

const MAX_VALUE = 100_000_000;

export const SAVE_DELAY_MS = 450;

const saveOutcome = (requestId: number): Effect => ({
  delayMs: SAVE_DELAY_MS,
  command: { type: 'saveResult', payload: { requestId, ok: true } },
});

function parse(type: string, payload: Payload): string | null {
  switch (type) {
    case 'selectExpense':
      return typeof payload.id === 'string' ? null : 'selectExpense needs an expense id.';
    case 'setSplitMode':
      return ['equal', 'percent', 'amount'].includes(payload.mode as string)
        ? null
        : 'setSplitMode needs equal, percent or amount.';
    case 'setSplit': {
      const { member, value } = payload;
      if (typeof member !== 'string') return 'setSplit needs a member.';
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_VALUE) {
        return 'setSplit needs a whole number that is not negative.';
      }
      return null;
    }
    case 'setView':
      return ['receipt', 'balances'].includes(payload.view as string)
        ? null
        : 'setView needs receipt or balances.';
    case 'saveResult':
      return Number.isInteger(payload.requestId) && typeof payload.ok === 'boolean'
        ? null
        : 'saveResult needs a requestId and ok.';
    default:
      return null;
  }
}

function describe(before: ReceiptState, command: Command, after: ReceiptState): string | null {
  switch (command.type) {
    case 'selectExpense': {
      const e = after.expenses.find((x) => x.id === after.selectedId)!;
      const payer = after.members.find((m) => m.id === e.paidBy)!;
      return `Opened ${e.merchant}: ${formatCents(e.totalCents)}, paid by ${payer.name}.`;
    }
    case 'setSplitMode':
      return `Switched the split to ${command.payload.mode}.`;
    case 'confirmEdit':
      return after.validation !== null
        ? `Tried to save. Error: ${after.validation.message}`
        : 'Saved the split.';
    case 'saveResult': {
      if (command.payload.ok !== true) return 'The save failed. The draft was kept.';
      const expense = after.expenses.find((e) => e.id === before.pendingSave?.expenseId)!;
      const ids = memberIds(after);
      const shares = sharesFor(expense.totalCents, expense.split, ids);
      const parts = after.members.map((m, i) => `${m.name} ${formatCents(shares[i]!)}`).join(', ');
      return `Save confirmed. ${expense.merchant} is now ${parts}. ${balanceLine(after, after.balances)}.`;
    }
    case 'setView':
      return command.payload.view === 'balances'
        ? `Balances: ${balanceLine(after, after.balances)}.`
        : 'Went back to the receipt.';
    case 'addReceipt': {
      const e = after.expenses.at(-1)!;
      return `Added ${e.merchant} for ${formatCents(e.totalCents)}.`;
    }
    case 'setSplit': {
      if (after.draft?.split.mode !== 'percent') return null;
      const member = after.members.find((m) => m.id === command.payload.member)!;
      return `Set ${member.name} to ${formatPercent(command.payload.value as number)}.`;
    }
    default:
      return null;
  }
}

/** Removes transient fields. Everything left must be plain JSON. */
function serialize(state: ReceiptState): Json {
  const { presentation: _presentation, ...data } = state;
  return data as unknown as Json;
}

export const receiptAdapter: SceneAdapter<ReceiptState> = {
  id: 'receipt-split',
  version: 1,
  title: 'Receipt split',
  summary: 'Open a synthetic shared expense, adjust the split and inspect the balances.',
  commandTypes: [
    'selectExpense',
    'setSplitMode',
    'setSplit',
    'confirmEdit',
    'cancelEdit',
    'saveResult',
    'setView',
    'addReceipt',
  ],
  targets: [
    { id: 'expense-list', label: 'Receipt list' },
    { id: 'receipt', label: 'Receipt' },
    { id: 'split-editor', label: 'Split editor' },
    { id: 'split-error', label: 'Split error' },
    { id: 'save', label: 'Save button' },
    { id: 'balances', label: 'Balances' },
    { id: 'preview', label: 'Balance preview' },
  ],
  layouts: {
    wide: { width: 880, height: 560 },
    narrow: { width: 360, height: 580 },
  },
  compactHeight: 440,
  init: initialState,
  parse,
  precondition,
  apply,
  effects(state, command): readonly Effect[] {
    if (command.type !== 'confirmEdit' || state.pendingSave === null) return [];
    return [saveOutcome(state.pendingSave.requestId)];
  },
  pendingEffects(state) {
    return state.pendingSave === null ? [] : [saveOutcome(state.pendingSave.requestId)];
  },
  serialize,
  restore(json) {
    return { ...(json as unknown as Omit<ReceiptState, 'presentation'>), presentation: { flash: null } };
  },
  describe,
  targetOf(command) {
    switch (command.type) {
      case 'selectExpense':
        return 'expense-list';
      case 'setSplit':
      case 'setSplitMode':
        return 'split-editor';
      case 'confirmEdit':
        return 'save';
      case 'setView':
        return command.payload.view === 'balances' ? 'balances' : 'receipt';
      default:
        return null;
    }
  },
  handoffTarget(state) {
    if (state.view === 'balances') return 'balances';
    return state.draft === null ? null : 'save';
  },
  Render,
};
