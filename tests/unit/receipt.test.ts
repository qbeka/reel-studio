import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import { receiptAdapter as adapter } from '../../src/scenes/receipt/adapter';
import { computeBalances } from '../../src/scenes/receipt/state';
import type { ReceiptState } from '../../src/scenes/receipt/state';
import { entry, frozen, hashState, outcome } from './helpers';

const scene = frozen(adapter);

function run(commands: LogEntry[], seed = 1): ReceiptState {
  let state: ReceiptState = scene.init(seed);
  for (const command of commands) {
    expect(scene.precondition(state, command)).toBeNull();
    state = scene.apply(state, command, { t: command.t });
  }
  return state;
}

describe('the receipt workflow', () => {
  const opened = [entry(0, 'selectExpense', { id: 'e2' }), entry(1, 'setSplitMode', { mode: 'percent' })];

  it('starts balanced', () => {
    const state = run([]);
    expect(Object.values(state.balances).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('rejects a save whose shares do not add up, and keeps the draft', () => {
    const state = run([
      ...opened,
      entry(2, 'setSplit', { member: 'mina', value: 6000 }),
      entry(3, 'confirmEdit'),
    ]);
    expect(state.validation?.code).toBe('percent-total');
    expect(state.pendingSave).toBeNull();
    expect(state.draft).not.toBeNull();
    expect(state.preview).toBeNull();
  });

  it('changes balances only after the save outcome arrives', () => {
    const edit = [
      ...opened,
      entry(2, 'setSplit', { member: 'mina', value: 5000 }),
      entry(3, 'setSplit', { member: 'theo', value: 2500 }),
      entry(4, 'setSplit', { member: 'ana', value: 2500 }),
    ];
    const before = run([]).balances;
    const editing = run(edit);
    expect(editing.balances).toEqual(before);
    expect(editing.preview).not.toEqual(before);

    const saving = run([...edit, entry(5, 'confirmEdit')]);
    expect(saving.pendingSave).not.toBeNull();
    expect(saving.balances).toEqual(before);

    const saved = run([
      ...edit,
      entry(5, 'confirmEdit'),
      outcome(6, 'saveResult', { requestId: 1, ok: true }),
    ]);
    expect(saved.pendingSave).toBeNull();
    expect(saved.balances).toEqual(editing.preview);
    expect(saved.balances).toEqual(computeBalances(saved.members, saved.expenses));
  });

  it('keeps the draft when the save outcome reports a failure', () => {
    const state = run([
      ...opened,
      entry(2, 'setSplit', { member: 'mina', value: 3334 }),
      entry(3, 'setSplit', { member: 'theo', value: 3333 }),
      entry(4, 'setSplit', { member: 'ana', value: 3333 }),
      entry(5, 'confirmEdit'),
      outcome(6, 'saveResult', { requestId: 1, ok: false }),
    ]);
    expect(state.validation?.code).toBe('save-failed');
    expect(state.draft).not.toBeNull();
  });

  it('keeps who pays what when switching split modes', () => {
    const percent = run(opened);
    const amount = run([...opened, entry(2, 'setSplitMode', { mode: 'amount' })]);
    expect(amount.preview).toEqual(percent.preview);
    const values = Object.values(amount.draft!.split.values);
    expect(values.reduce((a, b) => a + b, 0)).toBe(8750);
  });

  it('draws added receipts from seeded randomness', () => {
    const add = [entry(0, 'addReceipt'), entry(1, 'addReceipt')];
    expect(hashState(scene, run(add, 3))).toBe(hashState(scene, run(add, 3)));
    expect(hashState(scene, run(add, 3))).not.toBe(hashState(scene, run(add, 4)));
    const state = run(add, 3);
    expect(Object.values(state.balances).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('preconditions', () => {
  it('refuses edits with no open receipt', () => {
    const state = scene.init(1);
    expect(scene.precondition(state, { type: 'setSplit', payload: { member: 'mina', value: 1 } })).toMatch(/No receipt/);
    expect(scene.precondition(state, { type: 'confirmEdit', payload: {} })).toMatch(/No receipt/);
  });

  it('refuses everything but the outcome while a save is in flight', () => {
    const state = run([entry(0, 'selectExpense', { id: 'e1' }), entry(1, 'confirmEdit')]);
    expect(scene.precondition(state, { type: 'selectExpense', payload: { id: 'e2' } })).toMatch(/in progress/);
    expect(scene.precondition(state, { type: 'saveResult', payload: { requestId: 9, ok: true } })).toMatch(/No save/);
    expect(scene.precondition(state, { type: 'saveResult', payload: { requestId: 1, ok: true } })).toBeNull();
  });

  it.each([
    ['setSplit', { member: 'mina', value: -1 }],
    ['setSplit', { member: 'mina', value: 1.5 }],
    ['setSplit', { member: 1, value: 1 }],
    ['setSplitMode', { mode: 'magic' }],
    ['setView', { view: 'admin' }],
    ['saveResult', { requestId: 'x', ok: true }],
  ])('rejects the payload of %s %o', (type, payload) => {
    expect(scene.parse(type, payload as never)).not.toBeNull();
  });
});

describe('serialization', () => {
  it('survives a round trip and drops only presentation fields', () => {
    const state = run([entry(0, 'selectExpense', { id: 'e1' })]);
    expect(state.presentation.flash).toBe('e1');
    const restored = scene.restore(JSON.parse(JSON.stringify(scene.serialize(state))), 1);
    expect(restored.presentation.flash).toBeNull();
    expect(hashState(scene, restored)).toBe(hashState(scene, state));
  });

  it('does not let a presentation field change a hash', () => {
    const state = run([]);
    const flashed = { ...state, presentation: { flash: 'e2' } };
    expect(hashState(scene, flashed)).toBe(hashState(scene, state));
  });
});
