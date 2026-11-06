import { execFileSync } from 'node:child_process';
import { type Page, expect, test } from '@playwright/test';
import { type Host, hostBundle } from './helpers';

const PORT = 4318;
let host: Host;

test.beforeAll(async () => {
  execFileSync('pnpm', ['-s', 'build:site']);
  host = await hostBundle('dist/site', PORT);
});

test.afterAll(async () => {
  await host.close();
});

const open = async (page: Page) => {
  await page.goto(`${host.url}index.html`);
  await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
};

/** The scene's markup without the viewer's ring, which belongs to the story. */
const scene = (page: Page) =>
  page.locator('.reel-scene').evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    for (const ring of copy.querySelectorAll('.reel-ring')) ring.remove();
    return copy.innerHTML.replaceAll('data-idle="true"', '').replaceAll('data-idle="false"', '');
  });

test('the first screen is a working app at a useful moment', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Reel', level: 1 })).toBeVisible();
  await expect(page.getByText('A product demo you can actually use')).toBeVisible();
  await expect(page.locator('.rs-error')).toContainText('120%');
  await expect(page.getByText('Recorded, synthetic data')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take over' })).toBeInViewport();
});

test('taking over keeps the exact visible state, and the hairline forks', async ({ page }) => {
  await open(page);
  await page.getByRole('slider', { name: 'Story position' }).fill('13000');
  const before = await scene(page);
  await expect(page.locator('.reel-fork')).toHaveCount(0);
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByText('Live, synthetic data')).toBeVisible();
  expect(await scene(page)).toBe(before);
  await expect(page.locator('.reel-fork circle')).toHaveCount(1);
  await expect(page.locator('.reel-chapter-tick')).toHaveCount(5);
});

test('there is one default way back, and it says what happens to the copy', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Take over' }).click();
  await page.getByLabel('Ana share').fill('10');
  await expect(page.getByText('with 1 edit the recording never sees')).toBeVisible();
  await expect(page.locator('.control.primary')).toHaveText('Back to demo');
  await page.getByRole('button', { name: 'Back to demo' }).click();

  await expect(page.locator('.reel-narration')).toHaveText(
    'Back at 0:10, with your copy set aside until you take over or leave',
  );
  await expect(page.getByLabel('Ana share')).toHaveValue('30');
  await page.getByRole('button', { name: 'Bring my copy back' }).click();
  await expect(page.getByLabel('Ana share')).toHaveValue('10');
});

test('the page keeps its own address and leaves reading keys alone', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Details' })).toBeInViewport();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('slider', { name: 'Story position' }).fill('5000');
  expect(new URL(page.url()).hash).toBe('#details');
});

test('authoring turns a command into a chapter and exports a viewer with it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Author' }).click();
  await page.locator('.reel-step', { hasText: 'Set Ana to 10%' }).click();
  await page.getByLabel('Chapter title').fill('Ana pays less');
  await page.getByLabel('Caption').fill('Her share drops to a tenth.');
  await expect(page.locator('.reel-chapter-tick')).toHaveCount(6);
  await expect(page.locator('.reel-narration')).toHaveText('Her share drops to a tenth.');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toBe('receipt-split-release.zip');
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
});
