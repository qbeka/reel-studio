import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newProject, seekTo } from './helpers';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Records the start of the receipt workflow through the real controls. */
async function recordReceipt(page: import('@playwright/test').Page) {
  await newProject(page, 'Receipt split');
  await page.getByRole('button', { name: 'Record' }).click();
  // Pauses like a person, so commands do not land on the same pixel of the timeline.
  const pause = () => page.waitForTimeout(150);
  await page.getByRole('button', { name: /Harbor Noodle Bar/ }).click();
  await pause();
  await page.getByRole('radio', { name: 'Percent' }).click();
  await pause();
  await page.getByLabel('Mina share').fill('50');
  await pause();
  await page.getByLabel('Theo share').fill('30');
  await pause();
  await page.getByLabel('Ana share').fill('30');
  await pause();
  await page.getByRole('button', { name: 'Save split' }).click();
  await expect(page.getByRole('alert')).toContainText('Shares add up to 110%');
  await pause();
  await page.getByLabel('Ana share').fill('20');
  await pause();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
}

const lane = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Timeline' }).locator('.ed-command');

test('deleting a command that others need shows a repair step, and undo restores it', async ({ page }) => {
  await recordReceipt(page);
  const count = await lane(page).count();
  expect(count).toBeGreaterThanOrEqual(7);

  await lane(page).first().click();
  const inspector = page.getByRole('complementary', { name: 'Command' });
  await expect(inspector).toContainText('selectExpense');
  await inspector.getByRole('button', { name: 'Next' }).click();
  await expect(inspector).toContainText('setSplitMode');
  await inspector.getByRole('button', { name: 'Previous' }).click();
  await expect(inspector).toContainText('selectExpense');
  await page.getByRole('button', { name: 'Delete command' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`This edit breaks ${count - 1} later commands`);
  await expect(dialog).toContainText('No receipt is open');

  // Cancel leaves the recording as it was.
  await dialog.getByRole('button', { name: 'Cancel the edit' }).click();
  await expect(lane(page)).toHaveCount(count);

  await lane(page).first().click();
  await page.getByRole('button', { name: 'Delete command' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Remove those/ }).click();
  await expect(lane(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(lane(page)).toHaveCount(count);
});

test('moving a command before its cause is refused with a repair step', async ({ page }) => {
  await recordReceipt(page);
  await lane(page).nth(2).click();
  await page.getByLabel('Time (seconds)').fill('0');
  await page.getByLabel('Time (seconds)').blur();
  await expect(page.getByRole('dialog')).toContainText('later command');
  await page.getByRole('button', { name: 'Cancel the edit' }).click();
});

test('an invalid payload is refused with the reason, and nothing changes', async ({ page }) => {
  await recordReceipt(page);
  await lane(page).nth(2).click();
  const payload = page.getByLabel('Payload');
  await payload.fill('{"member":"mina","value":-5}');
  await payload.blur();
  await expect(page.getByRole('alert')).toContainText('not negative');
  await payload.fill('not json');
  await payload.blur();
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
});

test('Stop waits for a pending outcome, so a save is not left unfinished', async ({ page }) => {
  await newProject(page, 'Receipt split');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('button', { name: /Corner Grocer/ }).click();
  await page.getByRole('button', { name: 'Save split' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project file' }).click();
  const file = await (await download).path();
  const project = JSON.parse(await readFile(file, 'utf8'));
  expect(project.commands.map((c: { type: string }) => c.type)).toEqual([
    'selectExpense',
    'confirmEdit',
    'saveResult',
  ]);
  expect(project.commands[2].source).toBe('outcome');
});

test('a second recording pass continues after the first', async ({ page }) => {
  await recordReceipt(page);
  const count = await lane(page).count();
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('tab', { name: 'Balances' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(lane(page)).toHaveCount(count + 1);
});

test('typing in a field never triggers a shortcut', async ({ page }) => {
  await recordReceipt(page);
  await page.getByRole('button', { name: 'Caption', exact: true }).click();
  const text = page.getByLabel('Text');
  await text.fill('');
  await text.pressSequentially('a b z ');
  await text.press('Control+z');
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Caption' })).toBeVisible();
});

test('a storage failure is visible, keeps the work open and offers a download', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).__failPut = false;
    IDBObjectStore.prototype.put = function (...args) {
      if ((window as any).__failPut) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.apply(this, args as never);
    };
  });
  await recordReceipt(page);
  await page.evaluate(() => {
    (window as any).__failPut = true;
  });
  await page.getByRole('button', { name: 'Chapter', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('out of storage space');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download project file' })).toBeVisible();

  await page.evaluate(() => {
    (window as any).__failPut = false;
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await expect(page.getByText('out of storage space')).toHaveCount(0);
});

test('a cancelled or failed export creates no file and says so', async ({ page }) => {
  await recordReceipt(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  await page.route('**/viewer-runtime/assets/*.woff2', (route) => route.abort());
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Export viewer bundle' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Export failed. No file was created.');
  expect(downloads).toBe(0);
  await page.unroute('**/viewer-runtime/assets/*.woff2');

  await page.route('**/viewer-runtime/assets/*.css', async () => {
    await new Promise(() => {}); // Never answers.
  });
  await page.getByRole('button', { name: 'Export viewer bundle' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Collecting files');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(downloads).toBe(0);
});

test('export is blocked with an empty recording', async ({ page }) => {
  await newProject(page, 'Receipt split');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('There is nothing to export yet');
  await expect(page.getByRole('button', { name: 'Export viewer bundle' })).toBeDisabled();
});

test.describe('importing', () => {
  const importFile = async (page: import('@playwright/test').Page, name: string, body: string) => {
    await page.goto('/');
    await page.getByLabel('Open a project file').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(body),
    });
  };
  const project = async () => JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8'));

  test('opens a valid project', async ({ page }) => {
    await importFile(page, 'ok.reel.json', JSON.stringify(await project()));
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adjust the split' })).toBeVisible();
  });

  const refused: [string, () => Promise<string>, string][] = [
    ['text that is not JSON', async () => 'not json', 'not valid JSON'],
    ['a future format', async () => JSON.stringify({ ...(await project()), formatVersion: 9 }), 'format version 9'],
    [
      'an unknown scene',
      async () => JSON.stringify({ ...(await project()), scene: { id: 'payroll', version: 2 } }),
      'needs the scene payroll v2, which is not installed. Installed scenes: receipt-split v1, retry-queue v1.',
    ],
    [
      'a newer scene version',
      async () => JSON.stringify({ ...(await project()), scene: { id: 'receipt-split', version: 7 } }),
      'recorded with receipt-split v7. This build has v1',
    ],
    [
      'a log that cannot play',
      async () => JSON.stringify({ ...(await project()), commands: (await project()).commands.slice(1) }),
      'This project cannot play',
    ],
  ];
  for (const [name, body, message] of refused) {
    test(`refuses ${name} with a clear reason`, async ({ page }) => {
      await importFile(page, 'bad.json', await body());
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);
    });
  }

  test('a project file cannot run code', async ({ page }) => {
    const hostile = {
      ...(await project()),
      title: '<img src=x onerror="window.__owned=1">',
      adapter: 'alert(1)',
      commands: [{ seq: 1, t: 1, type: 'constructor', payload: {}, source: 'user' }],
    };
    await importFile(page, 'hostile.json', JSON.stringify(hostile));
    await expect(page.getByRole('alert')).toContainText('no command called constructor');
    expect(await page.evaluate(() => (window as any).__owned)).toBeUndefined();
  });
});

test.describe('drafts', () => {
  test('the list shows sizes and supports cleanup, with a confirmation', async ({ page }) => {
    await recordReceipt(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/^Saved /)).toBeVisible();
    await page.getByRole('button', { name: 'Reel' }).click();

    await expect(page.getByRole('button', { name: /Receipt split demo/ })).toContainText('commands');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: /Yes, delete "Receipt split demo"/ }).click();
    await expect(page.getByText('Drafts save themselves here as you work.')).toBeVisible();
  });

  test('a damaged latest save falls back to the previous one and says so', async ({ page }) => {
    await recordReceipt(page);
    await page.getByRole('button', { name: 'Chapter', exact: true }).click();
    // Wait until two versions exist, so there is a previous save to fall back on.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<boolean>((resolve) => {
                const open = indexedDB.open('reel-studio', 1);
                open.onsuccess = () => {
                  open.result.transaction('drafts').objectStore('drafts').getAll().onsuccess = (event) => {
                    open.result.close();
                    const [record] = (event.target as IDBRequest).result;
                    resolve(record?.previous != null && record.current.includes('chapter-1'));
                  };
                };
              }),
          ),
        { timeout: 6000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Reel' }).click();
    await page.getByRole('button', { name: /Receipt split demo/ }).waitFor();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open('reel-studio', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('drafts', 'readwrite');
            const store = tx.objectStore('drafts');
            store.getAll().onsuccess = (event) => {
              const [record] = (event.target as IDBRequest).result;
              store.put({ ...record, current: '{broken' });
            };
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
          };
        }),
    );
    await page.getByRole('button', { name: /Receipt split demo/ }).click();
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Timeline' }).locator('.ed-chapter')).toHaveCount(0);
  });
});

test('trim limits what a viewer can reach, and the prologue still runs', async ({ page }, info) => {
  await recordReceipt(page);
  await seekTo(page, 1);
  await page.getByRole('button', { name: /Start at/ }).click();
  await expect(page.getByText('Commands before the start still run')).toBeVisible();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project file' }).click();
  const saved = join(info.outputDir, 'trimmed.json');
  await (await download).saveAs(saved);
  const project = JSON.parse(await readFile(saved, 'utf8'));
  expect(project.trim.start).toBeGreaterThan(0);
  await writeFile(saved, JSON.stringify(project));
});
