/**
 * Browser defects found by a code review on a clean clone. Each of these failed
 * before its fix.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { projectFrom, receiptLog } from '../../bench/fixtures';
import { Timeline } from '../../src/core/timeline';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { type Host, hostBundle, newProject } from './helpers';

let host: Host;
let slow: Host;
const slowLog = receiptLog({ commands: 8000, expenses: 800, seed: 5 });

test.beforeAll(async () => {
  execFileSync('pnpm', ['-s', 'export', 'projects/receipt-split.reel.json', '--out', 'exports/e2e-regress']);
  host = await hostBundle('exports/e2e-regress', 4316);
  mkdirSync('exports', { recursive: true });
  const project = projectFrom(receiptAdapter, 'regress-slow', 'Slow', slowLog, 5, 100000);
  writeFileSync('exports/regress-slow.reel.json', JSON.stringify(project));
  execFileSync('pnpm', ['-s', 'export', 'exports/regress-slow.reel.json', '--out', 'exports/e2e-regress-slow']);
  slow = await hostBundle('exports/e2e-regress-slow', 4317);
});

test.afterAll(async () => {
  await host.close();
  await slow.close();
});

const panel = (page: Page) => page.getByRole('group', { name: 'Return to the story' });
const lane = (page: Page) => page.getByRole('region', { name: 'Timeline' }).locator('.ed-command');

test.describe('viewer', () => {
  test('a restored copy still warns before it is cleared', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Return to story' }).click();
    await panel(page).getByRole('button', { name: /Inspect the balances/ }).click();
    await page.getByRole('button', { name: 'Bring my copy back' }).click();
    await expect(page.getByLabel('Ana share')).toHaveValue('10');

    await page.getByRole('button', { name: 'Return to story' }).click();
    await expect(panel(page).getByRole('button', { name: /Inspect the balances/ })).toContainText('Clears your changes.');
    await panel(page).getByRole('button', { name: /Inspect the balances/ }).click();
    await expect(page.getByRole('status')).toContainText('Your changes are cleared');
    await expect(page.getByRole('button', { name: 'Bring my copy back' })).toHaveCount(1);
  });

  test('the scene cannot change behind the return panel', async ({ page }) => {
    await page.goto(`${host.url}#t=4000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
    await page.getByRole('button', { name: 'Return to story' }).click();
    await expect(panel(page).getByRole('button', { name: /Adjust the split/ })).toContainText('Matches your copy exactly.');
    await expect(page.locator('.reel-scene')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Keep experimenting' }).click();
    await expect(page.locator('.reel-scene')).not.toHaveAttribute('inert', '');
  });

  test('Try it during a recorded save lets the save finish', async ({ page }) => {
    await page.goto(`${host.url}#t=15500`);
    await page.getByRole('button', { name: 'Try it' }).click();
    const stage = page.getByRole('figure');
    await expect(stage.getByRole('button', { name: 'Save split' })).toBeEnabled({ timeout: 2000 });
    await stage.getByRole('button', { name: /Corner Grocer/ }).click();
    await expect(stage.getByRole('heading', { name: 'Corner Grocer' })).toBeVisible();
  });

  test('End while playing stays at the end', async ({ page }) => {
    await page.goto(host.url);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Story position' });
    await slider.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();
    await expect(slider).toHaveValue(await slider.getAttribute('max') as string);
  });

  test('Try it during a slow seek forks the state that was asked for', async ({ page }) => {
    await page.goto(slow.url);
    await page.waitForSelector('.reel-slider');
    const target = slowLog.at(-1)!.t;
    await page.evaluate((t) => {
      const slider = document.querySelector('.reel-slider') as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(slider, String(t));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((resolve) => setTimeout(resolve, 30)).then(() => {
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Try it')!.click();
      });
    }, target);
    await expect(page.getByText('This is your copy.')).toBeVisible({ timeout: 60_000 });
    const timeline = new Timeline<any>(receiptAdapter, slowLog, { seed: 5, checkpointEvery: 256 });
    const expected = timeline.stateAt(target).expenses.length;
    await expect(page.locator('.rs')).toContainText(`${expected} receipts`);
  });
});

test.describe('viewer, second review', () => {
  test('Try it waiting on a seek cannot replace a restored copy', async ({ page }) => {
    await page.goto(`${slow.url}#t=${slowLog[40]!.t}`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('button', { name: 'Add a sample receipt' }).click();
    await expect(page.getByText('1 edit so far.')).toBeVisible();
    await page.getByRole('button', { name: 'Return to story' }).click();
    await panel(page).getByRole('button', { name: /Part 4/ }).click();
    await page.evaluate(() => {
      const button = (name: string) =>
        [...document.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;
      button('Try it').click();
      button('Bring my copy back').click();
    });
    await expect(page.getByText('1 edit so far.')).toBeVisible();
    await page.waitForFunction(
      () => (document.querySelector('.reel-bar') as HTMLElement).dataset.seeking === 'false',
      undefined,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(200);
    await expect(page.getByText('1 edit so far.')).toBeVisible();
  });

  test('focus stays useful after Reset and Keep experimenting', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Return to story' }).click();
    await page.getByRole('button', { name: 'Keep experimenting' }).click();
    const status = page.getByText('This is your copy.').locator('..');
    await expect(status).toBeFocused();
    await page.getByRole('button', { name: 'Reset my changes' }).click();
    await expect(status).toBeFocused();
  });

  test('going back to the start clears the time from the address', async ({ page }) => {
    await page.goto(`${host.url}#t=5000`);
    await expect(page.getByRole('slider', { name: 'Story position' })).toHaveValue('5000');
    await page.getByRole('slider', { name: 'Story position' }).fill('0');
    await expect.poll(() => new URL(page.url()).hash).toBe('');
  });
});

test.describe('editor', () => {
  async function recordShort(page: Page) {
    await newProject(page, 'Receipt split');
    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(337);
    await page.getByRole('button', { name: /Harbor Noodle Bar/ }).click();
    await page.waitForTimeout(273);
    await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
  }

  async function downloadProject(page: Page) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download project file' }).click();
    const json = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    return json;
  }

  const drafts = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<any[]>((resolve) => {
          const open = indexedDB.open('reel-studio', 1);
          open.onsuccess = () => {
            const all = open.result.transaction('drafts').objectStore('drafts').getAll();
            all.onsuccess = () => {
              open.result.close();
              resolve(all.result.map((d: any) => ({ id: d.id, current: JSON.parse(d.current) })));
            };
          };
        }),
    );

  test('undo does nothing while recording', async ({ page }) => {
    await newProject(page, 'Receipt split');
    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: /Harbor Noodle Bar/ }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(100);
    await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
    await page.waitForTimeout(100);
    await page.locator('h1').click();
    await page.keyboard.press('Control+z');
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
    const project = await downloadProject(page);
    expect(project.commands.map((c: { type: string }) => c.type)).toEqual(['selectExpense', 'setSplitMode']);
  });

  test('the timeline and inspector are locked while recording', async ({ page }) => {
    await recordShort(page);
    await page.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByRole('button', { name: 'Reel', exact: true })).toBeDisabled();
    await expect(page.locator('.ed-timeline')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Stop' }).click();
  });

  test('leaving right after an edit keeps the edit', async ({ page }) => {
    await recordShort(page);
    await page.getByRole('button', { name: 'Chapter', exact: true }).click();
    await page.getByRole('button', { name: 'Reel', exact: true }).click();
    await page.getByRole('button', { name: /Receipt split demo/ }).waitFor();
    expect((await drafts(page))[0].current.chapters).toHaveLength(1);
  });

  test('tabbing through a time field changes nothing', async ({ page }) => {
    await recordShort(page);
    const before = await downloadProject(page);
    await lane(page).nth(1).click();
    const field = page.getByLabel('Time (seconds)');
    await field.focus();
    await field.blur();
    const after = await downloadProject(page);
    expect(after.commands.map((c: { t: number }) => c.t)).toEqual(before.commands.map((c: { t: number }) => c.t));
  });

  test('a command edit keeps the playhead', async ({ page }) => {
    await recordShort(page);
    const slider = page.getByRole('slider', { name: 'Story position' });
    await slider.fill('500');
    await expect(slider).toHaveValue('500');
    await lane(page).nth(1).click();
    await page.getByLabel('Time (seconds)').fill('1.5');
    await page.getByLabel('Time (seconds)').blur();
    await page.waitForTimeout(100);
    await expect(slider).toHaveValue('500');
  });

  test('a chapter past the file limit is refused with a reason, and the draft stays readable', async ({ page }) => {
    const project = JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8'));
    project.chapters = Array.from({ length: 64 }, (_, i) => ({ id: `c-${i}`, t: i * 100, title: `Part ${i}` }));
    await page.goto('/');
    await page.getByLabel('Open a project file').setInputFiles({
      name: 'full.reel.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByRole('button', { name: 'Record' }).waitFor();
    await page.getByRole('button', { name: 'Chapter', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('limit is 64');
    await expect(page.locator('.ed-chapter')).toHaveCount(64);
  });

  test('a refused retime leaves the field showing the stored time', async ({ page }) => {
    await recordShort(page);
    await lane(page).nth(1).click();
    const field = page.getByLabel('Time (seconds)');
    const before = await field.inputValue();
    await field.fill('0');
    await field.blur();
    await page.getByRole('button', { name: 'Cancel the edit' }).click();
    await expect(field).toHaveValue(before);
  });

  test('trim is unavailable with nothing recorded', async ({ page }) => {
    await newProject(page, 'Receipt split');
    await expect(page.getByRole('button', { name: /Start at 0:00/ })).toBeDisabled();
  });

  test('opening a file with an existing id makes a copy and keeps the draft', async ({ page }) => {
    await recordShort(page);
    const older = await downloadProject(page);
    await page.getByRole('button', { name: 'Chapter', exact: true }).click();
    await page.getByRole('button', { name: 'Reel', exact: true }).click();
    await page.getByRole('button', { name: /Receipt split demo/ }).waitFor();
    await page.getByLabel('Open a project file').setInputFiles({
      name: 'old.reel.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(older)),
    });
    await expect(page.getByRole('status').filter({ hasText: 'separate copy' })).toBeVisible();
    await page.getByRole('button', { name: 'Reel', exact: true }).click();
    await expect(page.getByRole('button', { name: /Receipt split demo/ })).toHaveCount(2);
    const list = await drafts(page);
    expect(list.some((d) => d.current.chapters.length === 1)).toBe(true);
  });
});
