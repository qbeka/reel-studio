import { describe, expect, it } from 'vitest';
import { allocate, formatCents, formatPercent, sharesFor, splitProblem } from '../../src/scenes/receipt/money';

describe('allocate', () => {
  it('splits 10.00 three ways with the extra cent on the first member', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it('gives leftover cents to the largest exact remainder, not to the first member', () => {
    // 100 at 10% / 45.5% / 44.5% is 10.0, 45.5 and 44.5. Both .5 remainders tie, so the
    // earlier one wins and the tie is stable.
    expect(allocate(100, [1000, 4550, 4450])).toEqual([10, 46, 44]);
    // 7 at 1/6/3 is 0.7, 4.2 and 2.1, so the cent goes to the first member.
    expect(allocate(7, [1, 6, 3])).toEqual([1, 4, 2]);
  });

  it('always sums to the total', () => {
    for (let total = 0; total < 3000; total += 7) {
      for (const weights of [[1, 1, 1], [3333, 3333, 3334], [1, 0, 9999], [7, 11, 13, 17]]) {
        const shares = allocate(total, weights);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe('splitProblem', () => {
  const ids = ['a', 'b'];

  it('names the actual percent total', () => {
    const problem = splitProblem(1000, { mode: 'percent', values: { a: 6000, b: 5000 } }, ids);
    expect(problem?.message).toBe('Shares add up to 110%. They need to add up to 100%.');
  });

  it('names the actual amount total', () => {
    const problem = splitProblem(1000, { mode: 'amount', values: { a: 400, b: 500 } }, ids);
    expect(problem?.message).toBe('Shares add up to $9.00. They need to add up to $10.00.');
  });

  it('treats a member with no value as zero', () => {
    expect(splitProblem(1000, { mode: 'percent', values: { a: 10000 } }, ids)).toBeNull();
    expect(sharesFor(1000, { mode: 'percent', values: { a: 10000 } }, ids)).toEqual([1000, 0]);
  });
});

describe('formatting', () => {
  it('formats cents without float rounding', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-1234)).toBe('-$12.34');
  });

  it('formats basis points', () => {
    expect(formatPercent(10000)).toBe('100%');
    expect(formatPercent(3350)).toBe('33.5%');
    expect(formatPercent(3333)).toBe('33.33%');
    expect(formatPercent(5)).toBe('0.05%');
  });
});
