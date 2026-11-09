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

/** The scene's markup. Controls only a viewer can use are in it from the start, but hidden. */
const scene = (page: Page) =>
  page
    .locator('.reel-scene')
    .evaluate((element) => element.innerHTML.replaceAll('data-idle="true"', '').replaceAll('data-idle="false"', ''));

const slider = (page: Page) => page.getByRole('slider', { name: 'Story position' });

test('the first screen is a working app at a useful moment', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Reel', level: 1 })).toBeVisible();
  await expect(page.getByText('A product demo you can actually use')).toBeVisible();
  await expect(page.locator('.rs-error')).toContainText('120%');
  await expect(page.getByText('Recorded, synthetic data')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take over' })).toBeInViewport();
});

test('the opening frame shows the whole product, at rest on the refused save', async ({ page }) => {
  await open(page);
  await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');
  await expect(page.locator('.rs-wordmark')).toHaveText('Tabkin');
  await expect(page.locator('.rs-bar')).toHaveAttribute('data-state', 'over');
  await expect(page.locator('.reel-caption')).toContainText('120%');
  // The drawn pointer rests on the control of the last command, which was the refused save.
  const pointer = (await page.locator('.reel-frame > .reel-cursor').boundingBox())!;
  const save = (await page.getByRole('button', { name: 'Save split' }).boundingBox())!;
  expect(pointer.x).toBeGreaterThan(save.x);
  expect(pointer.x).toBeLessThan(save.x + save.width);
  expect(pointer.y).toBeGreaterThan(save.y);
  expect(pointer.y).toBeLessThan(save.y + save.height);
});

test('Play tells the story from its start, and the camera closes in on the split', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(Number(await slider(page).inputValue())).toBeLessThan(4000);
  await page.getByRole('button', { name: 'Pause' }).click();
  await slider(page).fill('7000');
  await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'framed');
});

test('a chapter name jumps to its chapter, and the story ends on one thing to do', async ({ page }) => {
  await open(page);
  await expect(page.locator('.reel-chapter')).toHaveCount(5);
  await page.getByRole('button', { name: '4 Correct the shares' }).click();
  await expect(slider(page)).toHaveValue('12172');
  await expect(page.getByRole('button', { name: '4 Correct the shares' })).toHaveAttribute('aria-current', 'true');

  await expect(page.locator('.reel-end')).toHaveCount(0);
  await slider(page).fill('20000');
  await expect(page.locator('.reel-end .control')).toHaveCount(1);
  await page.getByRole('button', { name: 'Try it yourself' }).click();
  await expect(page.getByText('Live, synthetic data')).toBeVisible();
  await expect(page.locator('.reel-end')).toHaveCount(0);
});

test('taking over keeps the exact visible state, and the line forks', async ({ page }) => {
  await open(page);
  await slider(page).fill('13000');
  const before = await scene(page);
  await expect(page.locator('.reel-fork')).toHaveCount(0);
  await expect(page.locator('.reel-frame > .reel-cursor')).toHaveCount(1);
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByText('Live, synthetic data')).toBeVisible();
  expect(await scene(page)).toBe(before);
  // The stage stops drawing a pointer, because the viewer's own is now the one that counts.
  await expect(page.locator('.reel-frame > .reel-cursor')).toHaveCount(0);
  await expect(page.locator('.reel-box')).toHaveAttribute('data-mode', 'branch');
  await expect(page.locator('.reel-fork circle')).toHaveCount(1);
  await expect(page.locator('.reel-fork text')).toHaveText('Your copy');
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
  await expect(page.locator('.reel-fork text')).toHaveText('Set aside');
  await expect(page.locator('.reel-frame > .reel-cursor')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bring my copy back' }).click();
  await expect(page.getByLabel('Ana share')).toHaveValue('10');
});

test('the page keeps its own address and leaves reading keys alone', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Details' })).toBeInViewport();
  await page.keyboard.press('ArrowRight');
  await slider(page).fill('5000');
  expect(new URL(page.url()).hash).toBe('#details');
});

test('a link to a moment opens the page on that moment', async ({ page }) => {
  await page.goto(`${host.url}#t=16900`);
  await expect(page.getByRole('heading', { name: 'Who owes what' })).toBeVisible();
  await expect(slider(page)).toHaveValue('16900');
});

test('authoring turns a command into a chapter and exports a viewer with it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Author' }).click();
  await page.locator('.author-step', { hasText: 'Set Ana to 10%' }).click();
  await page.getByLabel('Chapter that starts at this command').fill('Ana pays less');
  await page.getByLabel('Caption').fill('Her share drops to a tenth.');
  await expect(page.locator('.reel-chapter')).toHaveCount(6);
  await expect(page.locator('.reel-lane-caption')).toHaveCount(5);

  // The camera is a track too. Framing the whole app from here ends the close view early.
  await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'framed');
  await page.getByLabel('Camera from this command on').selectOption({ label: 'The whole app' });
  await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toBe('receipt-split-release.zip');
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.reel-caption')).toHaveText('Her share drops to a tenth.');
});
