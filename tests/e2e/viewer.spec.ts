import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { type Host, hostBundle, seekTo } from './helpers';

const PORT = 4312;
let host: Host;

test.beforeAll(async () => {
  execFileSync('pnpm', ['-s', 'export', 'projects/receipt-split.reel.json', '--out', 'exports/e2e-viewer']);
  host = await hostBundle('exports/e2e-viewer', PORT);
});

test.afterAll(async () => {
  await host.close();
});

const slider = (page: Page) => page.getByRole('slider', { name: 'Story position' });
const stage = (page: Page) => page.getByRole('figure');

test.describe('keyboard', () => {
  test('transport keys work and their labels are visible', async ({ page }) => {
    await page.goto(host.url);
    await page.getByText('Keyboard').click();
    await expect(page.getByText('Previous or next chapter')).toBeVisible();

    await page.locator('h1').click();
    await page.keyboard.press('ArrowRight');
    await expect(slider(page)).toHaveValue('5000');
    await page.keyboard.press('ArrowLeft');
    await expect(slider(page)).toHaveValue('0');
    await page.keyboard.press(']');
    await expect(slider(page)).toHaveValue('4600');
    await page.keyboard.press('[');
    await expect(slider(page)).toHaveValue('0');
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('k');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.getByText('This is your copy.')).toBeVisible();
  });

  test('the slider follows the pattern and speaks time and chapter', async ({ page }) => {
    await page.goto(host.url);
    await slider(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider(page)).toHaveValue('1000');
    await page.keyboard.press('PageUp');
    await expect(slider(page)).toHaveValue('6000');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '0:06, chapter 2 of 5: Adjust the split');
    await page.keyboard.press('Home');
    await expect(slider(page)).toHaveValue('0');
    await page.keyboard.press('End');
    await expect(stage(page).getByRole('heading', { name: 'Who owes what' })).toBeVisible();
  });

  test('typing in a scene field does not trigger shortcuts', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    const field = page.getByLabel('Ana share');
    await field.fill('');
    await field.pressSequentially('12');
    await field.press('k');
    await field.press('t');
    await field.press(' ');
    await field.press('ArrowLeft');
    await expect(page.getByText('This is your copy.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  test('space on a focused button activates only that button', async ({ page }) => {
    await page.goto(host.url);
    await page.getByLabel('Full view').focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Full view')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  test('focus moves into the branch and back to Try it', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await expect(page.getByText('This is your copy.').locator('..')).toBeFocused();
    await page.getByRole('button', { name: 'Return to story' }).click();
    await expect(page.getByRole('group', { name: 'Return to the story' })).toBeFocused();
    await page.getByRole('button', { name: /where you paused/ }).click();
    await expect(page.getByRole('button', { name: 'Try it' })).toBeFocused();
  });
});

test.describe('seeking', () => {
  test('a command at exactly the seek time has happened, and one before it has not', async ({ page }) => {
    await page.goto(host.url);
    await slider(page).fill('10399');
    await expect(stage(page).getByRole('alert')).toHaveCount(0);
    await slider(page).fill('10400');
    await expect(stage(page).getByRole('alert')).toContainText('120%');
  });

  test('rapid scrubbing ends on the last request, with its state', async ({ page }) => {
    await page.goto(host.url);
    await slider(page).waitFor();
    await page.evaluate(() => {
      const input = document.querySelector('.reel-slider') as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (let i = 0; i < 200; i++) {
        set.call(input, String((i * 977) % 22000));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      set.call(input, '11000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(slider(page)).toHaveValue('11000');
    await expect(stage(page).getByRole('alert')).toContainText('120%');
  });

  test('seeking repeatedly never changes the story', async ({ page }) => {
    await page.goto(host.url);
    const read = () => stage(page).innerText();
    await seekTo(page, 20);
    const first = await read();
    for (const s of [3, 15, 0, 11, 20]) await seekTo(page, s);
    expect(await read()).toBe(first);
  });
});

test.describe('branching', () => {
  test('a timer never discards edits, and the story stays paused', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.waitForTimeout(3000);
    await expect(page.getByLabel('Ana share')).toHaveValue('10');
    await expect(page.getByText('1 edit so far.')).toBeVisible();
    await expect(slider(page)).toBeDisabled();
  });

  test('a save in the branch runs only the local fixture and makes no request', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByRole('button', { name: 'Save split' }).click();
    await expect(stage(page).getByRole('button', { name: 'Save split' })).toBeEnabled();
    await stage(page).getByRole('button', { name: 'Balances' }).click();
    await expect(stage(page).getByText('Who owes what')).toBeVisible();
    expect(requests).toEqual([]);
  });

  test('a refused action is explained in place', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('button', { name: 'Save split' }).click();
    await expect(stage(page).getByRole('alert')).toContainText('120%');
    await expect(page.getByText('This is your copy.')).toBeVisible();
  });

  test('Reset my changes returns to the moment of control', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Reset my changes' }).click();
    await expect(page.getByLabel('Ana share')).toHaveValue('30');
    await expect(page.getByText('Change anything.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset my changes' })).toBeDisabled();
  });

  test('a branch with no edits returns without losing anything', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('button', { name: 'Return to story' }).click();
    await expect(page.getByRole('group', { name: 'Return to the story' })).toContainText('Nothing to clear.');
    await page.getByRole('button', { name: /where you paused/ }).click();
    await expect(page.getByRole('status')).toContainText('Nothing was lost');
    await expect(page.getByRole('button', { name: 'Bring my copy back' })).toHaveCount(0);
  });

  test('the viewer can return by making the exact authored edit, and is told it matches', async ({ page }) => {
    await page.goto(`${host.url}#t=4000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
    await page.getByRole('button', { name: 'Return to story' }).click();
    const panel = page.getByRole('group', { name: 'Return to the story' });
    await expect(panel.getByRole('button', { name: /Adjust the split/ })).toContainText('Matches your copy exactly.');
    await expect(panel.getByRole('button', { name: /Open the receipt/ })).toContainText('Clears your changes.');
    await panel.getByRole('button', { name: /Adjust the split/ }).click();
    await expect(page.getByRole('status')).toContainText('Nothing was lost');
  });

  test('choosing a chapter brings the story back into view', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Return to story' }).click();
    const panel = page.getByRole('group', { name: 'Return to the story' });
    await panel.getByRole('button', { name: /Inspect the balances/ }).click();
    await expect(page.locator('.reel-frame')).toBeInViewport({ ratio: 0.9 });
    await expect(page.getByRole('button', { name: 'Try it' })).toBeFocused();
    await context.close();
  });

  test('the address never holds viewer content', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').fill('77');
    expect(new URL(page.url()).hash).toBe('#t=9000');
    expect(page.url()).not.toContain('77');
  });
});

test.describe('motion and framing', () => {
  test('reduced motion starts in the full view, with no transition and no autoplay', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${host.url}?embed=1&play=1#t=6000`);
    await expect(page.getByLabel('Full view')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const transition = await page.locator('.reel-scene').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toBe('0s');
    await context.close();
  });

  test('camera shots frame a target, and Full view turns them off', async ({ page }) => {
    await page.goto(`${host.url}#t=6000`);
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'framed');
    await page.getByLabel('Full view').check();
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');
  });

  test('a caption does not cover its active target', async ({ page }) => {
    await page.goto(`${host.url}#t=14000`);
    const caption = await page.locator('.reel-caption').boundingBox();
    const target = await page.locator('[data-reel-target="split-editor"]').boundingBox();
    expect(caption).not.toBeNull();
    expect(target).not.toBeNull();
    const overlap =
      Math.min(caption!.y + caption!.height, target!.y + target!.height) - Math.max(caption!.y, target!.y);
    expect(overlap).toBeLessThanOrEqual(1);
  });
});

test.describe('layouts', () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const) {
    test(`${width} px has no sideways scroll and a usable viewer`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(`${host.url}#t=14000`);
      await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const layout = await page.locator('.reel-stage').getAttribute('data-layout');
      expect(layout).toBe(width < 600 ? 'narrow' : 'wide');
      if (width < 600) {
        // The caption sits below the scene, in text of a readable size.
        const size = await page.locator('.reel-caption-strip').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(16);
        await expect(page.locator('.reel-caption-strip')).toContainText('Ana');
      }
      await context.close();
    });
  }

  test('200% zoom of a 1280 px window keeps everything reachable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`${host.url}#t=9000`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByLabel('Ana share').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Ana share')).toBeInViewport();
    await context.close();
  });

  test('the viewer works by touch on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Try it' }).tap();
    await page.getByLabel('Ana share').tap();
    await page.getByLabel('Ana share').fill('10');
    await expect(page.getByText('1 edit so far.')).toBeVisible();
    for (const name of ['Reset my changes', 'Return to story']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test('long labels stay inside their controls', async ({ page }) => {
    const project = JSON.parse(await readFile(join(host.root, 'projects/reel/project.reel.json'), 'utf8'));
    const long = 'A very long chapter title that keeps going well past what would normally fit on the line';
    project.title = `${long} and a project title too`;
    project.chapters[1].title = long;
    project.captions[1].text = `${long}, and then it keeps going even further, because authors do write long captions.`;
    const path = join(host.root, 'projects/long/');
    execFileSync('cp', ['-R', join(host.root, 'projects/reel'), path]);
    await writeFile(join(path, 'project.reel.json'), JSON.stringify(project));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${PORT}/projects/long/#t=6000`);
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('failure pages', () => {
  async function bundleWith(name: string, change: (project: any) => void) {
    const project = JSON.parse(await readFile(join(host.root, 'projects/reel/project.reel.json'), 'utf8'));
    change(project);
    const path = join(host.root, `projects/${name}`);
    execFileSync('cp', ['-R', join(host.root, 'projects/reel'), `${path}/`]);
    await writeFile(join(path, 'project.reel.json'), JSON.stringify(project));
    return `http://127.0.0.1:${PORT}/projects/${name}/`;
  }

  test('an unknown scene gives a clear message and the transcript', async ({ page }) => {
    await page.goto(await bundleWith('unknown', (p) => (p.scene = { id: 'payroll', version: 1 })));
    await expect(page.getByRole('alert')).toContainText('needs the scene payroll v1');
    await page.getByRole('link', { name: 'Read the transcript instead' }).click();
    await expect(page.getByText('Shares add up to 120%')).toBeVisible();
  });

  test('a newer scene version is refused', async ({ page }) => {
    await page.goto(await bundleWith('newer', (p) => (p.scene.version = 5)));
    await expect(page.getByRole('alert')).toContainText('This build has v1');
  });

  test('a command that cannot run stops the story with a message, not a guess', async ({ page }) => {
    await page.goto(await bundleWith('broken', (p) => p.commands.shift()));
    await expect(page.getByRole('alert')).toContainText('cannot play past this point');
    await expect(page.getByRole('link', { name: 'Read the transcript' })).toBeVisible();
  });

  test('a missing project file gives a message', async ({ page }) => {
    await page.route('**/project.reel.json', (route) => route.fulfill({ status: 404, body: 'gone' }));
    await page.goto(host.url);
    await expect(page.getByRole('alert')).toContainText('could not be read');
  });

  test('a missing transcript file does not stop the story', async ({ page }) => {
    await page.route('**/transcript.json', (route) => route.fulfill({ status: 404, body: 'gone' }));
    await page.goto(host.url);
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
  });
});

test.describe('embed', () => {
  test('a lazy iframe loads only the poster, then runs and unloads inside the frame', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    await page.goto(`${host.url}transcript.html`);
    await page.setContent(`<!doctype html><main><p>Host page</p>
      <iframe title="Demo" src="${host.url}embed.html" loading="lazy"
        style="width:720px;aspect-ratio:880/700;border:0"></iframe></main>`);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('link', { name: /Play interactive demo/ }).waitFor();
    expect(seen.filter((u) => u.endsWith('.js'))).toEqual([]);

    await frame.getByRole('link', { name: /Play interactive demo/ }).click();
    await expect(frame.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(frame.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(frame.getByRole('link', { name: 'Close the demo' })).toBeInViewport();

    await frame.getByRole('link', { name: 'Close the demo' }).click();
    await expect(frame.getByRole('link', { name: /Play interactive demo/ })).toBeVisible();
  });
});

test.describe('accessibility scan', () => {
  const scan = async (page: Page) => {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
  };

  test('finds no violations in the story, the branch or the return panel', async ({ page }) => {
    await page.goto(`${host.url}#t=14000`);
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
    expect(await scan(page)).toEqual([]);
    await page.getByRole('button', { name: 'Try it' }).click();
    expect(await scan(page)).toEqual([]);
    await page.getByRole('button', { name: 'Return to story' }).click();
    expect(await scan(page)).toEqual([]);
  });

  test('finds no violations in the embed or transcript', async ({ page }) => {
    await page.goto(`${host.url}embed.html`);
    expect(await scan(page)).toEqual([]);
    await page.goto(`${host.url}transcript.html`);
    expect(await scan(page)).toEqual([]);
  });

  test('finds no violations in the editor', async ({ page }) => {
    await page.goto('/');
    expect(await scan(page)).toEqual([]);
    await page.getByRole('button', { name: /^Receipt split/ }).click();
    await page.getByRole('button', { name: 'Record' }).waitFor();
    expect(await scan(page)).toEqual([]);
  });
});
