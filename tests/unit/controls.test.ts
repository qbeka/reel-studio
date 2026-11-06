import { beforeAll, describe, expect, it } from 'vitest';
import { type ControlResult, runControls, staleSeekScenario } from '../../bench/controls';
import { SeekController } from '../../src/core/seek';

let results: ControlResult[];

beforeAll(async () => {
  results = await runControls();
}, 60_000);

describe('negative controls', () => {
  it('runs every seeded failure', () => {
    expect(results.length).toBeGreaterThanOrEqual(14);
  });

  it('detects every seeded failure', () => {
    const missed = results.filter((r) => !r.detected).map((r) => `${r.id}: ${r.detail}`);
    expect(missed).toEqual([]);
  });

  it('shows the seek check alone cannot see money bugs', () => {
    const money = results.filter((r) => r.group === 'money');
    expect(money.length).toBeGreaterThanOrEqual(5);
    const seen = money.filter((r) => !r.seekCheckBlind).map((r) => `${r.id}: ${r.detail}`);
    expect(seen).toEqual([]);
  });

  it('the real controller commits only the newest seek', async () => {
    const commits = await staleSeekScenario(
      (timeline, out, yieldToHost) =>
        new SeekController(timeline, (r) => out.push(r.time), { sliceBudget: 8, sliceMs: 0, yieldToHost }),
    );
    expect(commits).toHaveLength(1);
  });
});
