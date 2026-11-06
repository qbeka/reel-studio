import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { type Host, hostBundle, seekTo } from './helpers';

const PORT = 4311;
let host: Host;

test.beforeAll(async () => {
  execFileSync('pnpm', ['-s', 'export', 'projects/receipt-split.reel.json', '--out', 'exports/e2e-receipt']);
  host = await hostBundle('exports/e2e-receipt', PORT);
});

test.afterAll(async () => {
  await host.close();
});

test.beforeEach(async ({ page }) => {
  host.requests.length = 0;
  host.watch(page);
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('runs from a clean folder under a nested path on a plain static server', async ({ page }) => {
  await page.goto(host.url);
  await expect(page.getByRole('heading', { name: 'Fix a shared receipt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();

  const base = new URL(host.url);
  for (const url of host.requests) {
    const parsed = new URL(url);
    expect(parsed.origin, url).toBe(base.origin);
    expect(parsed.pathname.startsWith(base.pathname), url).toBe(true);
  }
});

test('a link without the trailing slash reaches the viewer through the host redirect', async ({ page }) => {
  await page.goto(host.url.slice(0, -1));
  await expect(page.getByRole('heading', { name: 'Fix a shared receipt' })).toBeVisible();
});

test('seeks to the validation error and shows the scene state for that time', async ({ page }) => {
  await page.goto(host.url);
  await seekTo(page, 11);
  const stage = page.getByRole('figure');
  await expect(stage.getByRole('alert').filter({ hasText: 'Shares add up to 120%' })).toBeVisible();
  await seekTo(page, 2);
  await expect(stage.getByText('Shares add up to 120%')).toHaveCount(0);
  await seekTo(page, 21);
  await expect(page.getByRole('heading', { name: 'Who owes what' })).toBeVisible();
});

test('plays the story to the end', async ({ page }) => {
  await page.goto(`${host.url}#t=17000`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who owes what' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible({ timeout: 8000 });
});

test('the viewer takes control, sees a recomputed result and returns at a chapter', async ({ page }) => {
  await page.goto(`${host.url}#t=9000`);
  await expect(page.getByLabel('Ana share')).toHaveValue('30');
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByText('This is your copy')).toBeVisible();

  await page.getByLabel('Ana share').fill('10');
  await expect(page.getByText('with 1 edit the recording never sees')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Balances after this split' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose a moment' }).click();
  const panel = page.getByRole('group', { name: 'Choose a moment' });
  await panel.getByRole('button', { name: /Inspect the balances/ }).click();
  await expect(page.getByRole('status')).toContainText('with your copy set aside');
  await expect(page.getByRole('heading', { name: 'Who owes what' })).toBeVisible();

  await page.getByRole('button', { name: 'Bring my copy back' }).click();
  await expect(page.getByText('with 1 edit the recording never sees')).toBeVisible();
  await expect(page.getByLabel('Ana share')).toHaveValue('10');
});

test('the embed shows a poster, loads no script until activated and can be closed', async ({ page }) => {
  await page.goto(`${host.url}embed.html`);
  await expect(page.getByRole('link', { name: /Play interactive demo/ })).toBeVisible();
  expect(host.requests.filter((u) => u.endsWith('.js'))).toEqual([]);

  await page.getByRole('link', { name: /Play interactive demo/ }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('link', { name: 'Close the demo' }).click();
  await expect(page.getByRole('link', { name: /Play interactive demo/ })).toBeVisible();
});

test('the transcript page works with JavaScript off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${host.url}transcript.html`);
  await expect(page.getByText('Shares add up to 120%')).toBeVisible();
  // Selector engines skip <noscript>, so read the rendered text of the page.
  await page.goto(host.url);
  expect(await page.locator('body').innerText()).toContain('Shares add up to 120%');
  await context.close();
});

test('an invalid link is ignored, and the viewer opens at the poster', async ({ page }) => {
  await page.goto(`${host.url}#t=999999999`);
  await expect(page.getByRole('slider', { name: 'Story position' })).toHaveValue('14000');
  await page.goto(`${host.url}#chapter=%3Cscript%3E`);
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Story position' })).toHaveValue('14000');
});

test('a chapter link opens at that chapter', async ({ page }) => {
  await page.goto(`${host.url}#chapter=balances`);
  await expect(page.getByRole('heading', { name: 'Who owes what' })).toBeVisible();
});
