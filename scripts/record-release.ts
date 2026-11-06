/**
 * Records the release story through the real editor: clicks in a browser, at a person's
 * pace, with chapters, captions and camera shots added through the interface. It saves the
 * project and the exported bundle in the run folder, and a copy of the project for tests.
 *
 *   pnpm build && pnpm exec tsx scripts/record-release.ts
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, chromium } from '@playwright/test';

const PORT = 5177;
const run = join('runs', `${new Date().toISOString().slice(0, 10)}-release`);
await mkdir(run, { recursive: true });

const server: ChildProcess = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The preview server did not start.');
}

interface Command {
  type: string;
  t: number;
}

/** Reads exact command times from the project file, as an author's own tooling could. */
async function readCommands(page: Page): Promise<Command[]> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project file' }).click();
  const path = await (await download).path();
  await page.getByRole('button', { name: 'Close' }).click();
  return JSON.parse(await readFile(path, 'utf8')).commands;
}

async function setPosition(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Story position' }).fill(String(t));
}

async function addChapter(page: Page, t: number, title: string) {
  await setPosition(page, t);
  await page.getByRole('button', { name: 'Chapter', exact: true }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Title').blur();
}

async function addCaption(page: Page, start: number, end: number, text: string, target: string) {
  await setPosition(page, start);
  await page.getByRole('button', { name: 'Caption', exact: true }).click();
  await page.getByLabel('Text').fill(text);
  await page.getByLabel('Text').blur();
  await page.getByLabel('Ends at (seconds)').fill((end / 1000).toFixed(1));
  await page.getByLabel('Ends at (seconds)').blur();
  await page.getByLabel('Target').selectOption({ label: target });
}

async function addShot(page: Page, t: number, target: string | null) {
  await setPosition(page, t);
  await page.getByRole('button', { name: 'Camera shot', exact: true }).click();
  if (target !== null) await page.getByLabel('Target').selectOption({ label: target });
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  const pause = (ms: number) => page.waitForTimeout(ms);

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: /^Receipt split/ }).click();
  await page.getByRole('button', { name: 'Record' }).click();

  await pause(1800);
  await page.getByRole('button', { name: /Harbor Noodle Bar/ }).click();
  await pause(2400);
  await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
  await pause(1500);
  await page.getByLabel('Mina share').fill('50');
  await pause(1100);
  await page.getByLabel('Theo share').fill('40');
  await pause(1100);
  await page.getByLabel('Ana share').fill('30');
  await pause(1600);
  await page.getByRole('button', { name: 'Save split' }).click();
  await pause(3000);
  await page.getByLabel('Ana share').fill('10');
  await pause(1600);
  await page.getByRole('button', { name: 'Save split' }).click();
  await pause(2600);
  await page.getByRole('button', { name: 'Balances' }).click();
  await pause(3200);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Record' }).waitFor();

  const commands = await readCommands(page);
  const at = (type: string, index = 0) => commands.filter((c) => c.type === type)[index]!.t;

  const percent = at('setSplitMode');
  const bad = at('confirmEdit', 0);
  const fix = at('setSplit', 3);
  const balances = at('setView');
  const end = balances + 3200;

  await addChapter(page, 0, 'Open the receipt');
  await addChapter(page, percent, 'Adjust the split');
  await addChapter(page, bad, 'Hit a validation error');
  await addChapter(page, fix - 400, 'Correct the shares');
  await addChapter(page, balances, 'Inspect the balances');

  await addCaption(page, 200, percent - 200, 'Theo paid for dinner, split equally. Open that receipt.', 'Receipt list');
  await addCaption(page, percent + 100, bad - 200, 'Mina had more. Switch to percent and adjust the shares.', 'Split editor');
  await addCaption(page, bad + 100, fix - 400, 'The shares add up to 120%, so the save is refused.', 'Save button');
  await addCaption(page, fix - 300, balances - 200, 'Lower Ana to 10% and the same save goes through.', 'Split editor');
  await addCaption(page, balances + 100, end, 'Balances are recomputed from every receipt.', 'Balances');

  await addShot(page, 0, null);
  await addShot(page, percent, 'Split editor');
  await addShot(page, balances, null);

  await setPosition(page, fix + 300);
  await page.getByRole('button', { name: 'Project settings' }).click();
  await page.getByRole('button', { name: /as the poster/ }).click();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project file' }).click();
  const projectPath = join(run, 'recorded.reel.json');
  await (await projectDownload).saveAs(projectPath);

  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export viewer bundle' }).click();
  await (await zipDownload).saveAs(join(run, 'receipt-split-viewer.zip'));

  await browser.close();

  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  project.id = 'receipt-split-release';
  project.title = 'Fix a shared receipt';
  project.disclosure = 'Synthetic data. No real people, receipts or balances.';
  await writeFile('projects/receipt-split-release.reel.json', `${JSON.stringify(project, null, 2)}\n`);
  await copyFile('projects/receipt-split-release.reel.json', join(run, 'project.reel.json'));
  console.log(`${commands.length} commands recorded through the editor. Saved to ${run}.`);
} finally {
  server.kill();
}
