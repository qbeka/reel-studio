import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseProject } from '../../src/core/project';
import { hashJson } from '../../src/core/sha256';
import { type Host, hostBundle, newProject, seekTo } from './helpers';

/**
 * The release path, in order, through ordinary entry points: open the second registered
 * scene, record a real workflow, edit chapters and captions, save, reopen, export, open
 * the result under a nested static path, seek, take control and return.
 */
test('a second scene goes from recording to a hosted interactive demo', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  /* Record ------------------------------------------------------------------------- */
  await newProject(page, 'Retry queue');
  await expect(page.getByText('It does not record pixels or mouse positions.')).toBeVisible();

  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('button', { name: 'Send an event' }).click();
  await expect(page.getByText('Waiting to retry')).toBeVisible();
  await page.getByRole('radio', { name: 'Healthy (200)' }).check();
  await expect(page.getByText('Delivered after', { exact: false })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();

  const commands = page.getByRole('region', { name: 'Timeline' }).locator('.ed-command');
  const count = await commands.count();
  expect(count).toBeGreaterThanOrEqual(4);

  /* Chapters and captions ----------------------------------------------------------- */
  await seekTo(page, 0);
  await page.getByRole('button', { name: 'Chapter', exact: true }).click();
  await page.getByLabel('Title').fill('Send into a failing endpoint');
  await page.getByLabel('Title').blur();
  await expect(page.getByRole('button', { name: 'Send into a failing endpoint' })).toBeVisible();

  await page.getByRole('button', { name: 'Caption', exact: true }).click();
  await page.getByLabel('Text').fill('The first attempt fails, so the job backs off.');
  await page.getByLabel('Text').blur();
  await page.getByLabel('Ends at (seconds)').fill('2');
  await page.getByLabel('Ends at (seconds)').blur();

  /* Undo and redo reach the edit ---------------------------------------------------- */
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();

  /* Save and reopen ------------------------------------------------------------------ */
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Retry queue demo/ }).click();
  await expect(page.getByRole('button', { name: 'Send into a failing endpoint' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timeline' }).locator('.ed-command')).toHaveCount(count);

  /* Export --------------------------------------------------------------------------- */
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export viewer bundle' }).click();
  const zip = await download;
  await expect(page.getByRole('status').filter({ hasText: 'KB downloaded' })).toBeVisible();

  const work = await mkdtemp(join(tmpdir(), 'reel-accept-'));
  const zipPath = join(work, 'bundle.zip');
  await zip.saveAs(zipPath);
  execFileSync('unzip', ['-q', zipPath, '-d', join(work, 'bundle')]);
  const verified = execFileSync('pnpm', ['-s', 'tsx', 'scripts/verify-bundle.ts', join(work, 'bundle')]);
  expect(verified.toString()).toContain('verified');

  /* Saved evidence ------------------------------------------------------------------- */
  await mkdir(info.outputDir, { recursive: true });
  await copyFile(zipPath, info.outputPath('retry-queue-viewer.zip'));

  /* Hosted, nested, with the dev tools gone ------------------------------------------- */
  const host: Host = await hostBundle(join(work, 'bundle'), 4321, 'projects/reel');
  const before = await readFile(join(host.root, 'projects/reel/project.reel.json'));
  const viewer = await page.context().newPage();
  viewer.on('pageerror', (error) => errors.push(error.message));
  host.watch(viewer);
  await viewer.goto(host.url);
  await expect(viewer.getByRole('heading', { name: 'Retry queue demo' })).toBeVisible();

  const stage = viewer.getByRole('figure');
  await seekTo(viewer, 0);
  await expect(stage.getByText('Send an event to watch it retry')).toBeVisible();

  const raw = JSON.parse(before.toString());
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const last = parsed.project.commands.at(-1)!;
  await viewer.getByRole('slider', { name: 'Story position' }).fill(String(last.t));
  await expect(stage.getByText('Delivered after', { exact: false })).toBeVisible();

  /* Take control, then return --------------------------------------------------------- */
  await viewer.getByRole('button', { name: 'Take over' }).click();
  await expect(viewer.getByText('This is your copy')).toBeVisible();
  await stage.getByRole('button', { name: 'Send an event' }).click();
  await expect(stage.getByText('Event 2')).toBeVisible();
  await expect(viewer.getByText('with 1 edit the recording never sees')).toBeVisible();

  await viewer.getByRole('button', { name: 'Choose a moment' }).click();
  await viewer
    .getByRole('group', { name: 'Choose a moment' })
    .getByRole('button', { name: /Send into a failing endpoint/ })
    .click();
  await expect(viewer.getByRole('status')).toContainText('with your copy set aside');
  await expect(stage.getByText('Event 2')).toHaveCount(0);

  /* The source is unchanged, and a reload restores the story -------------------------- */
  expect(hashJson(JSON.parse((await readFile(join(host.root, 'projects/reel/project.reel.json'))).toString()))).toBe(hashJson(raw));
  await viewer.reload();
  await expect(stage.getByText('Event 2')).toHaveCount(0);
  expect(await viewer.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  const base = new URL(host.url);
  for (const url of host.requests) {
    expect(new URL(url).pathname.startsWith(base.pathname), url).toBe(true);
  }

  expect(errors).toEqual([]);
  await host.close();
  await rm(work, { recursive: true, force: true });
});
