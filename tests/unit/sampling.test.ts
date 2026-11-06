import { describe, expect, it } from 'vitest';
import { positionQuantiles, seededTimes } from '../../bench/sampling';
import { receiptLog } from '../../bench/fixtures';

/**
 * A skewed sample made a benchmark look better than it was, so uniformity is tested. The
 * bounds are wide enough for sampling noise and narrow enough to fail the old generator,
 * whose median position was 0.2 to 0.38.
 */
describe('seededTimes', () => {
  const log = receiptLog({ commands: 20000, expenses: 40, seed: 21 });

  it('samples positions uniformly across the log', () => {
    for (let seed = 2001; seed <= 2010; seed++) {
      const { p10, p50, p90 } = positionQuantiles(log, seededTimes(log, 300, seed));
      expect(p50, `median for seed ${seed}`).toBeGreaterThan(0.4);
      expect(p50, `median for seed ${seed}`).toBeLessThan(0.6);
      expect(p10).toBeLessThan(0.17);
      expect(p90).toBeGreaterThan(0.83);
    }
  });

  it('is reproducible, distinct, and varies with the seed', () => {
    const times = seededTimes(log, 300, 7);
    expect(times).toEqual(seededTimes(log, 300, 7));
    expect(new Set(times).size).toBe(300);
    expect(times).not.toEqual(seededTimes(log, 300, 8));
  });

  it('uses every distinct time when asked for more than exist', () => {
    const short = log.slice(0, 9);
    expect(seededTimes(short, 300, 7)).toHaveLength(new Set(short.map((c) => c.t)).size);
  });
});
