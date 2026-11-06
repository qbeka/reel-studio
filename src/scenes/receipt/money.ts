/** All money is integer cents. All percentages are integer basis points (10000 = 100%). */

export type SplitMode = 'equal' | 'percent' | 'amount';

export interface Split {
  mode: SplitMode;
  /** Keyed by member id. Basis points in `percent`, cents in `amount`, empty in `equal`. */
  values: Record<string, number>;
}

export const FULL_BPS = 10000;

/**
 * Hamilton's largest remainder method. Each member gets the floor of their exact share,
 * then the leftover cents go to the largest fractional parts. Ties go to the earlier
 * member, which makes the result deterministic and keeps the sum exactly `totalCents`.
 *
 * `weights` must be non-negative integers with a positive sum.
 */
export function allocate(totalCents: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const floors = weights.map((w) => Math.floor((totalCents * w) / weightSum));
  // The remainder is computed in integers, since a float fraction could misorder ties.
  const remainders = weights.map((w, i) => (totalCents * w) - floors[i]! * weightSum);
  let left = totalCents - floors.reduce((sum, f) => sum + f, 0);
  const order = remainders.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    floors[i]!++;
    left--;
  }
  return floors;
}

/** Why a split cannot be saved, or null when it is valid. Message is shown to the user. */
export function splitProblem(
  totalCents: number,
  split: Split,
  memberIds: readonly string[],
): { code: string; message: string } | null {
  if (split.mode === 'equal') return null;
  const values = memberIds.map((id) => split.values[id] ?? 0);
  const sum = values.reduce((a, b) => a + b, 0);
  if (split.mode === 'percent') {
    if (sum !== FULL_BPS) {
      return {
        code: 'percent-total',
        message: `Shares add up to ${formatPercent(sum)} but need to add up to 100%`,
      };
    }
    return null;
  }
  if (sum !== totalCents) {
    return {
      code: 'amount-total',
      message: `Shares add up to ${formatCents(sum)} but need to add up to ${formatCents(totalCents)}`,
    };
  }
  return null;
}

/** Each member's share in cents, in member order. The split must be valid. */
export function sharesFor(
  totalCents: number,
  split: Split,
  memberIds: readonly string[],
): number[] {
  switch (split.mode) {
    case 'equal':
      return allocate(totalCents, memberIds.map(() => 1));
    case 'percent':
      return allocate(totalCents, memberIds.map((id) => split.values[id] ?? 0));
    case 'amount':
      return memberIds.map((id) => split.values[id] ?? 0);
  }
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const part = bps % 100;
  return part === 0 ? `${whole}%` : `${whole}.${String(part).padStart(2, '0').replace(/0$/, '')}%`;
}
