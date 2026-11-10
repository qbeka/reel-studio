import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLAIMS_RUN, type SiteClaims, buildClaims, claimText, fillClaims, ms } from '../../scripts/site-data';

/**
 * The project page quotes numbers. Each one is marked in its markup with the name of the
 * measurement it is, and this checks every mark against the run folder it names, so the
 * page cannot drift from what was measured.
 */
describe('the numbers on the project page', () => {
  let claims: SiteClaims;
  let text: Record<string, string>;
  let page: string;
  let stored: SiteClaims;
  beforeAll(async () => {
    claims = await buildClaims();
    text = claimText(claims);
    page = await readFile('site/index.html', 'utf8');
    stored = JSON.parse(await readFile('site/data/claims.json', 'utf8'));
  });

  it('are all in the run they name', () => {
    expect(fillClaims(page, text)).toBe(page);
  });

  it('are quoted somewhere, with none left unmarked in a figure', () => {
    const quoted = new Set([...page.matchAll(/data-claim="([a-z0-9.]+)"/g)].map((match) => match[1]));
    for (const name of ['stress.p95', 'stress.baseline', 'stress.min', 'stress.max', 'short.p95', 'short.baseline', 'positions', 'mismatches', 'controls.caught', 'blind.caught', 'first.seek', 'run.date', 'load.max']) {
      expect(quoted, name).toContain(name);
    }
    for (const name of quoted) expect(text, name).toHaveProperty([name!]);
  });

  it('feed the figures from the same run', () => {
    expect(stored).toEqual(claims);
    expect(stored.run.folder).toBe(CLAIMS_RUN);
  });

  it('refuse a mark the run cannot answer', () => {
    expect(() => fillClaims('<span data-claim="made.up">1</span>', text)).toThrow(/made\.up/);
  });

  it('keep the baseline beside the headline, and the tie beside the win', () => {
    const { stress, short } = claims.seek;
    expect(stress.baseline.median).toBeGreaterThan(stress.checkpointed.median);
    // The real recording shows no gain, and the page has to say so in the same breath.
    expect(page).toContain('it changes nothing');
    expect(page).toMatch(/The gain only appears on a generated stress log/);
    expect(short.checkpointed.perRun).toHaveLength(5);
  });

  it('are written the way the page writes a time', () => {
    expect(ms(3.2)).toBe('3.2');
    expect(ms(22.1)).toBe('22');
    expect(ms(1074.1)).toBe('1,074');
  });
});
