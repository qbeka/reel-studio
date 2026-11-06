import { useEffect, useState } from 'react';
import type { SceneProps } from '../../core/adapter';
import { FULL_BPS, type SplitMode, formatCents, formatPercent, sharesFor, splitProblem } from './money';
import { type Expense, type ReceiptState, memberIds, selectedExpense } from './state';

/** How many receipts the list shows. The stage is a fixed size, so a long ledger is windowed. */
const LIST_WINDOW = 6;

/** The receipts on screen: the most recent ones, always including the open receipt. */
function visibleExpenses(state: ReceiptState): Expense[] {
  const recent = state.expenses.slice(-LIST_WINDOW);
  const selected = selectedExpense(state);
  if (selected === null || recent.includes(selected)) return recent;
  return [selected, ...recent.slice(1)];
}

function ExpenseList({ state, send, interactive }: SceneProps<ReceiptState>) {
  const visible = visibleExpenses(state);
  return (
    <section className="rs-list" data-reel-target="expense-list" aria-label="Receipts">
      <h2>Receipts</h2>
      <ul>
        {visible.map((expense) => (
          <li key={expense.id}>
            <button
              type="button"
              className="rs-expense"
              data-selected={expense.id === state.selectedId}
              data-flash={state.presentation.flash === expense.id}
              aria-current={expense.id === state.selectedId ? 'true' : undefined}
              onClick={() => send('selectExpense', { id: expense.id })}
            >
              <span className="rs-expense-name">{expense.merchant}</span>
              <span className="rs-expense-meta">
                {expense.date} · {formatCents(expense.totalCents)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="rs-list-foot">
        {state.expenses.length > visible.length
          ? `${visible.length} of ${state.expenses.length} receipts`
          : `${state.expenses.length} receipts`}
      </p>
      {interactive && (
        <button type="button" className="rs-quiet" onClick={() => send('addReceipt')}>
          Add a sample receipt
        </button>
      )}
    </section>
  );
}

/**
 * A number box for shares. It keeps the typed text locally, so a half-typed or empty value
 * sends nothing. Only a complete whole number becomes a `setSplit` command.
 */
function ShareField({
  label,
  value,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  unit: 'percent' | 'amount';
  onCommit: (value: number) => void;
}) {
  const shown = unit === 'percent' ? String(value / 100) : (value / 100).toFixed(2);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  return (
    <input
      className="rs-share"
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (!/^\d{1,7}(\.\d{0,2})?$/.test(next)) return;
        onCommit(Math.round(Number(next) * 100));
      }}
      onBlur={() => setText(shown)}
    />
  );
}

function SplitEditor({ state, send, interactive }: SceneProps<ReceiptState>) {
  const expense = selectedExpense(state);
  if (expense === null || state.draft === null) {
    return (
      <div className="rs-empty">
        <p>Pick a receipt to see how it is split.</p>
      </div>
    );
  }
  const { split } = state.draft;
  const ids = memberIds(state);
  const problem = splitProblem(expense.totalCents, split, ids);
  const shares = problem === null ? sharesFor(expense.totalCents, split, ids) : null;
  const payer = state.members.find((m) => m.id === expense.paidBy)!;
  const percentTotal = ids.reduce((sum, id) => sum + (split.values[id] ?? 0), 0);
  const saving = state.pendingSave !== null;

  return (
    <div className="rs-detail">
      <header className="rs-receipt" data-reel-target="receipt">
        <div>
          <h2>{expense.merchant}</h2>
          <p>
            {expense.date}. Paid by {payer.name}.
          </p>
        </div>
        <strong className="rs-total">{formatCents(expense.totalCents)}</strong>
        <ul className="rs-items">
          {expense.items.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <span>{formatCents(item.cents)}</span>
            </li>
          ))}
        </ul>
      </header>

      <section className="rs-split" data-reel-target="split-editor" aria-label="Split">
        <fieldset className="rs-modes">
          <legend>Split method</legend>
          {(['equal', 'percent', 'amount'] as SplitMode[]).map((mode) => (
            <label key={mode} data-active={split.mode === mode}>
              <input
                type="radio"
                name="rs-split-mode"
                checked={split.mode === mode}
                onChange={() => send('setSplitMode', { mode })}
              />
              {mode === 'equal' ? 'Equal' : mode === 'percent' ? 'Percent' : 'Amount'}
            </label>
          ))}
        </fieldset>

        <table className="rs-shares">
          <tbody>
            {state.members.map((member, i) => (
              <tr key={member.id} data-flash={state.presentation.flash === member.id}>
                <th scope="row">{member.name}</th>
                <td>
                  {split.mode === 'equal' ? (
                    <span className="rs-muted">Equal</span>
                  ) : (
                    <ShareField
                      label={`${member.name} share`}
                      unit={split.mode}
                      value={split.values[member.id] ?? 0}
                      onCommit={(value) => send('setSplit', { member: member.id, value })}
                    />
                  )}
                </td>
                <td className="rs-num">{shares === null ? '-' : formatCents(shares[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {split.mode === 'percent' && (
          <p className="rs-sum" data-off={percentTotal !== FULL_BPS}>
            Total {formatPercent(percentTotal)}
          </p>
        )}
        {state.validation !== null && (
          <p className="rs-error" role="alert" data-reel-target="split-error">
            {state.validation.message}
          </p>
        )}

        <div className="rs-actions">
          <button
            type="button"
            className="rs-primary"
            data-reel-target="save"
            disabled={saving}
            onClick={() => send('confirmEdit')}
          >
            {saving ? 'Saving' : 'Save split'}
          </button>
          {interactive && (
            <button type="button" className="rs-quiet" disabled={saving} onClick={() => send('cancelEdit')}>
              Undo changes
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function BalanceRows({
  state,
  balances,
}: {
  state: ReceiptState;
  balances: Record<string, number>;
}) {
  const largest = Math.max(1, ...state.members.map((m) => Math.abs(balances[m.id] ?? 0)));
  return (
    <ul className="rs-balances">
      {state.members.map((member) => {
        const value = balances[member.id] ?? 0;
        return (
          <li key={member.id}>
            <span>{member.name}</span>
            <span className="rs-bar" aria-hidden="true">
              <span
                data-side={value < 0 ? 'owes' : 'owed'}
                style={{ width: `${(Math.abs(value) / largest) * 100}%` }}
              />
            </span>
            <span className="rs-num">
              {value === 0
                ? 'Settled'
                : value > 0
                  ? `Owed ${formatCents(value)}`
                  : `Owes ${formatCents(-value)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Tabs({ state, send }: SceneProps<ReceiptState>) {
  return (
    <nav className="rs-tabs" aria-label="Receipt view">
      {(['receipt', 'balances'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={state.view === view}
          data-active={state.view === view}
          onClick={() => send('setView', { view })}
        >
          {view === 'receipt' ? 'Receipt' : 'Balances'}
        </button>
      ))}
    </nav>
  );
}

export function Render(props: SceneProps<ReceiptState>) {
  const { state, layout } = props;
  const showPreview = state.view === 'receipt' && state.preview !== null;
  return (
    <div className="rs" data-layout={layout}>
      <ExpenseList {...props} />
      <div className="rs-main">
        <Tabs {...props} />
        {state.view === 'receipt' ? (
          <SplitEditor {...props} />
        ) : (
          <section className="rs-panel" data-reel-target="balances" aria-label="Balances">
            <h2>Who owes what</h2>
            <BalanceRows state={state} balances={state.balances} />
            <p className="rs-muted">
              Computed from all {state.expenses.length} receipts. Amounts add up to zero.
            </p>
          </section>
        )}
        {showPreview && (
          <section className="rs-preview" data-reel-target="preview" aria-label="Balances after this split">
            <h3>Balances with this split</h3>
            <BalanceRows state={state} balances={state.preview!} />
          </section>
        )}
      </div>
    </div>
  );
}
