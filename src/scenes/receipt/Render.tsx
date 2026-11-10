import { type ReactNode, useEffect, useState } from 'react';
import type { SceneProps } from '../../core/adapter';
import {
  FULL_BPS,
  type Split,
  type SplitMode,
  formatCents,
  formatPercent,
  sharesFor,
  splitProblem,
} from './money';
import { type Expense, type Member, type ReceiptState, memberIds, selectedExpense } from './state';

/**
 * The visual layer of Tabkin, the invented product this scene demonstrates. Everything
 * here is drawn from the state it is given. Nothing reads a clock or keeps data of its
 * own, so a seek, a replay and a server render all show the same thing.
 */

/** How many receipts the list shows. The stage is a fixed size, so a long ledger is windowed. */
const LIST_WINDOW = 6;
/** How many receipts the ledger on the balances screen spells out. Earlier ones are counted. */
const LEDGER_WINDOW = 3;

/** The share bar keeps this much of its width as headroom, so a split over 100% has somewhere to go. */
const BAR_FULL = 78;
/** The widest the bar draws, as a share of the receipt. Anything beyond is cut off at the edge. */
const BAR_LIMIT = 100 / BAR_FULL;

/** One hue per person, in member order. It repeats if a scene ever has more people. */
const HUES = ['blue', 'amber', 'rose'] as const;
const hueOf = (index: number) => HUES[index % HUES.length]!;

/** The receipts on screen: the most recent ones, always including the open receipt. */
function visibleExpenses(state: ReceiptState): Expense[] {
  const recent = state.expenses.slice(-LIST_WINDOW);
  const selected = selectedExpense(state);
  if (selected === null || recent.includes(selected)) return recent;
  return [selected, ...recent.slice(1)];
}

const sameSplit = (a: Split, b: Split, ids: readonly string[]) =>
  a.mode === b.mode && ids.every((id) => (a.values[id] ?? 0) === (b.values[id] ?? 0));

function Avatar({ member, index, small = false }: { member: Member; index: number; small?: boolean }) {
  return (
    <span className="rs-avatar" data-hue={hueOf(index)} data-small={small} aria-hidden="true">
      {member.name.slice(0, 1)}
    </span>
  );
}

/** Line drawings for the invented merchants. An unknown merchant gets a plain receipt. */
const MARKS: Record<string, ReactNode> = {
  'Corner Grocer': (
    <path d="M4.5 7.5h11l-1 7.5h-9l-1-7.5ZM7.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5" />
  ),
  'Harbor Noodle Bar': (
    <path d="M3.5 9.5h13a6.5 6.5 0 0 1-13 0ZM7 16h6M6.5 7c1-1 1-2 0-3M10 7c1-1 1-2 0-3M13.5 7c1-1 1-2 0-3" />
  ),
  'Fernway Utilities': <path d="M11 3.5 5.5 11H10l-1 5.5L14.5 9H10l1-5.5Z" />,
  'Linden Bakery': (
    <path d="M4 10.5c0-3 2.5-5 6-5s6 2 6 5v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3.5ZM8 8v2.5M12 8v2.5" />
  ),
  'Northline Transit': (
    <path d="M6 4.5h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 14 14.500H6A1.5 1.5 0 0 1 4.5 13V6A1.5 1.5 0 0 1 6 4.5ZM4.5 10h11M7 16.500l1-2M13 16.500l-1-2M7.5 12.200h.01M12.5 12.200h.01" />
  ),
  'Oak Street Hardware': (
    <path d="M5 5h7.500l2.5 2.5-2 2-1.5-1.500H9v8H6.500V8H5V5Z" />
  ),
  'Sable Coffee': (
    <path d="M4.5 8h9v4a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4V8ZM13.5 9.500h1a1.5 1.5 0 0 1 0 3h-1M7 5.500c.7-.7.7-1.3 0-2M10.5 5.500c.7-.7.7-1.3 0-2" />
  ),
};
const PLAIN_MARK = <path d="M6 3.5h8v13l-2-1.3-2 1.3-2-1.3-2 1.300v-13ZM8 7.500h4M8 10.500h4" />;

function MerchantMark({ merchant, large = false }: { merchant: string; large?: boolean }) {
  return (
    <span className="rs-mark" data-large={large} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          {MARKS[merchant] ?? PLAIN_MARK}
        </g>
      </svg>
    </span>
  );
}

function Brand({ state }: { state: ReceiptState }) {
  return (
    <div className="rs-brand">
      <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
        <rect width="22" height="22" rx="6" fill="currentColor" />
        <path d="M6 6.500h10M11 6.500v9.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <path d="M14.2 11.800l2.3 2.3-2.3 2.3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity=".7" />
      </svg>
      <span className="rs-wordmark">Tabkin</span>
      <span className="rs-people" aria-hidden="true">
        {state.members.map((member, i) => (
          <Avatar key={member.id} member={member} index={i} small />
        ))}
      </span>
    </div>
  );
}

function ExpenseList({ state, send, interactive }: SceneProps<ReceiptState>) {
  const visible = visibleExpenses(state);
  return (
    <section className="rs-list" data-reel-target="expense-list" aria-label="Receipts">
      <Brand state={state} />
      <h2>Receipts</h2>
      <ul>
        {visible.map((expense) => {
          const payer = state.members.find((m) => m.id === expense.paidBy);
          return (
            <li key={expense.id}>
              <button
                type="button"
                className="rs-expense"
                data-reel-point={`expense:${expense.id}`}
                data-selected={expense.id === state.selectedId}
                data-flash={state.presentation.flash === expense.id}
                aria-current={expense.id === state.selectedId ? 'true' : undefined}
                onClick={() => send('selectExpense', { id: expense.id })}
              >
                <MerchantMark merchant={expense.merchant} />
                <span className="rs-expense-name">{expense.merchant}</span>
                <span className="rs-expense-total">{formatCents(expense.totalCents)}</span>
                <span className="rs-expense-meta">
                  {expense.date}
                  <span className="rs-payer"> · {payer?.name ?? 'Someone'} paid</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="rs-list-foot">
        {state.expenses.length > visible.length
          ? `${visible.length} of ${state.expenses.length} receipts`
          : `${state.expenses.length} receipts`}
      </p>
      {/* Always in the layout, so that taking over moves nothing. */}
      <button type="button" className="rs-add" data-idle={!interactive} onClick={() => send('addReceipt')}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M8 3.500v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Add a sample receipt
      </button>
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
  point,
  onCommit,
}: {
  label: string;
  value: number;
  unit: 'percent' | 'amount';
  point: string;
  onCommit: (value: number) => void;
}) {
  const shown = unit === 'percent' ? String(value / 100) : (value / 100).toFixed(2);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  return (
    <span className="rs-field" data-unit={unit} data-reel-point={point}>
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
    </span>
  );
}

/**
 * The split as one bar. The outlined box is the whole receipt. Shares that add up to more
 * than the receipt run past its right edge, and the part outside is hatched.
 */
function ShareBar({ parts, whole }: { parts: readonly number[]; whole: number }) {
  const sum = parts.reduce((a, b) => a + b, 0);
  const safeWhole = Math.max(1, whole);
  const ratio = Math.min(BAR_LIMIT, sum / safeWhole);
  const over = Math.max(0, ratio - 1);
  const state = sum === whole ? 'exact' : sum > whole ? 'over' : 'under';
  return (
    <div className="rs-bar" data-state={state} aria-hidden="true">
      <span className="rs-bar-box" style={{ width: `${BAR_FULL}%` }} />
      <span className="rs-bar-fill" style={{ width: `${ratio * BAR_FULL}%` }}>
        {parts.map((part, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: one segment per member, in member order.
            key={i}
            data-hue={hueOf(i)}
            style={{ flexGrow: sum === 0 ? 1 : part, opacity: sum === 0 ? 0 : 1 }}
          />
        ))}
      </span>
      <span className="rs-bar-over" style={{ left: `${BAR_FULL}%`, width: `${over * BAR_FULL}%` }} />
      <span className="rs-bar-mark" style={{ left: `${BAR_FULL}%` }} />
    </div>
  );
}

/** What the shares add up to, and how far that is from the receipt. */
function sumLine(mode: SplitMode, sum: number, total: number): { text: string; off: string | null } {
  if (mode === 'percent') {
    const gap = sum - FULL_BPS;
    return {
      text: `Total ${formatPercent(sum)}`,
      off: gap === 0 ? null : gap > 0 ? `${formatPercent(gap)} over` : `${formatPercent(-gap)} left`,
    };
  }
  const gap = sum - total;
  return {
    text: `Total ${formatCents(sum)} of ${formatCents(total)}`,
    off: gap === 0 ? null : gap > 0 ? `${formatCents(gap)} over` : `${formatCents(-gap)} left`,
  };
}

/** A person's net position in a few words. */
function standing(value: number): string {
  if (value === 0) return 'Settled';
  return value > 0 ? `Owed ${formatCents(value)}` : `Owes ${formatCents(-value)}`;
}

function SplitEditor({ state, send, interactive }: SceneProps<ReceiptState>) {
  const expense = selectedExpense(state);
  if (expense === null || state.draft === null) {
    return (
      <div className="rs-empty">
        <svg viewBox="0 0 56 64" width="56" height="64" fill="none" aria-hidden="true">
          <path
            d="M8 4h40v56l-6.7-4-6.7 4-6.6-4-6.7 4-6.6-4L8 60V4Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            strokeLinejoin="round"
          />
          <path d="M17 18h22M17 27h22M17 36h13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <p>Pick a receipt to see how it is split</p>
      </div>
    );
  }
  const { split } = state.draft;
  const ids = memberIds(state);
  const total = expense.totalCents;
  const problem = splitProblem(total, split, ids);
  const shares = problem === null ? sharesFor(total, split, ids) : null;
  const payerIndex = state.members.findIndex((m) => m.id === expense.paidBy);
  const payer = state.members[payerIndex]!;
  const values = ids.map((id) => split.values[id] ?? 0);
  const sum = values.reduce((a, b) => a + b, 0);
  const saving = state.pendingSave !== null;
  const dirty = !sameSplit(split, expense.split, ids);
  const refused = state.validation !== null;
  const summary = split.mode === 'equal' ? null : sumLine(split.mode, sum, total);
  // While the shares do not add up there is no real split, so each row shows what its own
  // number would come to, in a quieter colour.
  const rough = values.map((value) => (split.mode === 'percent' ? Math.round((total * value) / FULL_BPS) : value));
  // Shown once a save has come back, until the next thing happens.
  const saved =
    !saving && !dirty && state.nextRequestId > 1 && state.presentation.flash === expense.id;

  return (
    <div className="rs-detail">
      <article className="rs-receipt" data-reel-target="receipt">
        <header>
          <MerchantMark merchant={expense.merchant} large />
          <div>
            <h2>{expense.merchant}</h2>
            <p>
              {expense.date}, paid by {payer.name}
            </p>
          </div>
        </header>
        <ul className="rs-items">
          {expense.items.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <i aria-hidden="true" />
              <span>{formatCents(item.cents)}</span>
            </li>
          ))}
        </ul>
        <p className="rs-receipt-total">
          <span>Total</span>
          <strong className="rs-total">{formatCents(total)}</strong>
        </p>
        <span className="rs-stub" aria-hidden="true" />
      </article>

      <section
        className="rs-split"
        data-reel-target="split-editor"
        data-refused={refused}
        aria-label="Split"
      >
        <div className="rs-split-head">
          <h3>Split between {state.members.length}</h3>
          <fieldset className="rs-modes">
            <legend>Split method</legend>
            {(['equal', 'percent', 'amount'] as SplitMode[]).map((mode) => (
              <label key={mode} data-active={split.mode === mode} data-reel-point={`mode:${mode}`}>
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
        </div>

        <div className="rs-gauge">
          <ShareBar
            parts={split.mode === 'equal' ? ids.map(() => 1) : values}
            whole={split.mode === 'equal' ? ids.length : split.mode === 'percent' ? FULL_BPS : total}
          />
          {summary !== null && (
            <p className="rs-sum" data-off={summary.off !== null}>
              {summary.text}
              {summary.off !== null && <span>{summary.off}</span>}
            </p>
          )}
        </div>

        <table className="rs-shares">
          <tbody>
            {state.members.map((member, i) => (
              <tr key={member.id} data-flash={state.presentation.flash === member.id}>
                <th scope="row">
                  <Avatar member={member} index={i} />
                  {member.name}
                </th>
                <td>
                  {split.mode === 'equal' ? (
                    <span className="rs-muted">Equal share</span>
                  ) : (
                    <ShareField
                      label={`${member.name} share`}
                      unit={split.mode}
                      point={`share:${member.id}`}
                      value={split.values[member.id] ?? 0}
                      onCommit={(value) => send('setSplit', { member: member.id, value })}
                    />
                  )}
                </td>
                <td className="rs-num" data-rough={shares === null}>
                  {formatCents(shares === null ? rough[i]! : shares[i]!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {state.validation !== null && (
          <p className="rs-error" role="alert" data-reel-target="split-error">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M8 2.5 14 13H2L8 2.500Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6.500v3M8 11.200h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>{state.validation.message}</span>
          </p>
        )}

        <div className="rs-actions">
          <button
            type="button"
            className="rs-primary"
            data-reel-target="save"
            data-reel-point="save"
            data-saving={saving}
            disabled={saving}
            onClick={() => send('confirmEdit')}
          >
            {saving ? 'Saving' : 'Save split'}
          </button>
          <button
            type="button"
            className="rs-quiet"
            data-idle={!interactive}
            disabled={saving}
            onClick={() => send('cancelEdit')}
          >
            Undo changes
          </button>
          <span className="rs-state" data-state={saving ? 'saving' : dirty ? 'dirty' : 'clean'}>
            <i aria-hidden="true" />
            {saving ? 'Sending' : dirty ? 'Not saved yet' : 'Up to date'}
          </span>
        </div>
      </section>

      {(saving || saved) && (
        <p className="rs-toast" data-kind={saving ? 'saving' : 'saved'}>
          <i aria-hidden="true" />
          {saving ? 'Saving the split' : 'Saved, and the balances are up to date'}
        </p>
      )}
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
      {state.members.map((member, i) => {
        const value = balances[member.id] ?? 0;
        return (
          <li key={member.id}>
            <span className="rs-who">
              <Avatar member={member} index={i} />
              {member.name}
            </span>
            <span className="rs-meter" aria-hidden="true">
              <span
                data-side={value < 0 ? 'owes' : 'owed'}
                style={{ width: `${(Math.abs(value) / largest) * 50}%` }}
              />
            </span>
            <span className="rs-num" data-side={value === 0 ? 'even' : value < 0 ? 'owes' : 'owed'}>
              {standing(value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** How a balance moves if the draft is saved, in the words of the person it belongs to. */
function movement(now: number, after: number): { text: string; way: 'better' | 'worse' | 'same' } {
  const gap = after - now;
  if (gap === 0) return { text: 'No change', way: 'same' };
  return gap > 0
    ? { text: `${formatCents(gap)} better off`, way: 'better' }
    : { text: `${formatCents(-gap)} worse off`, way: 'worse' };
}

/**
 * What saving the draft would do to each person, beside where they stand now. It reads the
 * two sets of balances the state already holds and keeps nothing of its own.
 */
function AfterSplit({ state }: { state: ReceiptState }) {
  const { preview, balances } = state;
  const ready = preview !== null;
  const shown = preview ?? balances;
  const largest = Math.max(1, ...state.members.map((m) => Math.abs(shown[m.id] ?? 0)));
  return (
    <section
      className="rs-preview"
      data-reel-target="preview"
      data-ready={ready}
      aria-label="Balances after this split"
    >
      <header>
        <h3>Balances with this split</h3>
        <p className="rs-muted">
          {ready
            ? `Worked out across all ${state.expenses.length} receipts`
            : 'Where things stand now, until the shares add up'}
        </p>
      </header>
      <ul className="rs-after">
        {state.members.map((member, i) => {
          const now = balances[member.id] ?? 0;
          const value = shown[member.id] ?? 0;
          const moved = movement(now, value);
          return (
            <li key={member.id} data-way={ready ? moved.way : 'waiting'}>
              <span className="rs-who">
                <Avatar member={member} index={i} small />
                {member.name}
              </span>
              <strong className="rs-num" data-side={value === 0 ? 'even' : value < 0 ? 'owes' : 'owed'}>
                {standing(value)}
              </strong>
              <span className="rs-meter" aria-hidden="true">
                <span
                  data-side={value < 0 ? 'owes' : 'owed'}
                  style={{ width: `${(Math.abs(value) / largest) * 50}%` }}
                />
              </span>
              <span className="rs-moved">{ready ? moved.text : 'Before this split'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Payment {
  from: number;
  to: number;
  cents: number;
}

/**
 * The fewest obvious payments that clear every balance: each person who owes pays the
 * people who are owed, in member order. It reads the balances and changes nothing.
 */
function settlements(state: ReceiptState, balances: Record<string, number>): Payment[] {
  const left = state.members.map((m) => balances[m.id] ?? 0);
  const payments: Payment[] = [];
  for (let from = 0; from < left.length; from++) {
    for (let to = 0; to < left.length && left[from]! < 0; to++) {
      if (left[to]! <= 0) continue;
      const cents = Math.min(-left[from]!, left[to]!);
      left[from]! += cents;
      left[to]! -= cents;
      payments.push({ from, to, cents });
    }
  }
  return payments;
}

/**
 * The receipts the balances come from, one row each, with what every person's share of it
 * is. Only the most recent rows are worked out and drawn, so a long ledger costs no more
 * than a short one, and the last row is the net the state already holds.
 */
function Ledger({ state }: { state: ReceiptState }) {
  const ids = memberIds(state);
  const recent = state.expenses.slice(-LEDGER_WINDOW);
  const earlier = state.expenses.length - recent.length;
  return (
    <table className="rs-ledger">
      <thead>
        <tr>
          <th scope="col">Receipt</th>
          <th scope="col">Paid by</th>
          {state.members.map((member) => (
            <th key={member.id} scope="col" className="rs-num">
              {member.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {earlier > 0 && (
          <tr className="rs-ledger-more">
            <td colSpan={2 + ids.length}>
              {earlier} earlier {earlier === 1 ? 'receipt' : 'receipts'} counted the same way
            </td>
          </tr>
        )}
        {recent.map((expense) => {
          const shares = sharesFor(expense.totalCents, expense.split, ids);
          const payer = state.members.findIndex((m) => m.id === expense.paidBy);
          return (
            <tr key={expense.id}>
              <th scope="row">
                <span>{expense.merchant}</span>
                <span className="rs-muted">{formatCents(expense.totalCents)}</span>
              </th>
              <td>
                <span className="rs-who">
                  <Avatar member={state.members[payer]!} index={payer} small />
                </span>
              </td>
              {shares.map((share, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: one cell per member, in member order.
                <td key={i} className="rs-num" data-paid={i === payer}>
                  {formatCents(share)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={2}>
            Net
          </th>
          {state.members.map((member) => {
            const value = state.balances[member.id] ?? 0;
            return (
              <td key={member.id} className="rs-num" data-side={value === 0 ? 'even' : value < 0 ? 'owes' : 'owed'}>
                {value > 0 ? '+' : ''}
                {formatCents(value)}
              </td>
            );
          })}
        </tr>
      </tfoot>
    </table>
  );
}

function BalancesPanel({ state }: { state: ReceiptState }) {
  const payments = settlements(state, state.balances);
  return (
    <section className="rs-panel" data-reel-target="balances" aria-label="Balances">
      <div className="rs-standing">
        <header>
          <h2>Who owes what</h2>
          <p className="rs-muted">
            Computed from all {state.expenses.length} receipts, and the amounts add up to zero
          </p>
        </header>
        <BalanceRows state={state} balances={state.balances} />
      </div>
      <div className="rs-settle">
        <h3>To settle up</h3>
        {payments.length === 0 ? (
          <p className="rs-muted">Nobody owes anything</p>
        ) : (
          <ul>
            {payments.map(({ from, to, cents }) => (
              <li key={`${from}-${to}`}>
                <span className="rs-who">
                  <Avatar member={state.members[from]!} index={from} small />
                  {state.members[from]!.name}
                </span>
                <span className="rs-pays">
                  <span>pays</span>
                  <svg viewBox="0 0 28 8" width="28" height="8" fill="none" aria-hidden="true">
                    <path d="M1 4h25M22.5 1l3.500 3-3.500 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="rs-who">
                  <Avatar member={state.members[to]!} index={to} small />
                  {state.members[to]!.name}
                </span>
                <span className="rs-num">{formatCents(cents)}</span>
              </li>
            ))}
          </ul>
        )}
        {payments.length > 0 && (
          <p className="rs-settle-sum">
            {payments.length === 1 ? 'One payment clears' : `${payments.length} payments clear`}{' '}
            {formatCents(payments.reduce((sum, payment) => sum + payment.cents, 0))}
          </p>
        )}
      </div>
      <div className="rs-source">
        <h3>Where it comes from</h3>
        <Ledger state={state} />
      </div>
    </section>
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
          data-reel-point={`view:${view}`}
          onClick={() => send('setView', { view })}
        >
          {view === 'receipt' ? 'Receipt' : 'Balances'}
        </button>
      ))}
      <span className="rs-sample">Sample data</span>
    </nav>
  );
}

export function Render(props: SceneProps<ReceiptState>) {
  const { state, layout } = props;
  const onReceipt = state.view === 'receipt';
  const hasDraft = onReceipt && state.draft !== null && selectedExpense(state) !== null;
  return (
    <div className="rs" data-layout={layout}>
      <ExpenseList {...props} />
      <div className="rs-main">
        <Tabs {...props} />
        {onReceipt ? <SplitEditor {...props} /> : <BalancesPanel state={state} />}
        {hasDraft && <AfterSplit state={state} />}
      </div>
    </div>
  );
}
