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
    await page.goto(`${host.url}#t=0`);
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
    await expect(page.getByText('This is your copy')).toBeVisible();
  });

  test('the slider follows the pattern and speaks time and chapter', async ({ page }) => {
    await page.goto(`${host.url}#t=0`);
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
    await page.getByRole('button', { name: 'Take over' }).click();
    const field = page.getByLabel('Ana share');
    await field.fill('');
    await field.pressSequentially('12');
    await field.press('k');
    await field.press('t');
    await field.press(' ');
    await field.press('ArrowLeft');
    await expect(page.getByText('This is your copy')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  test('space on a focused button activates only that button', async ({ page }) => {
    await page.goto(host.url);
    const full = page.getByRole('button', { name: 'Full view' });
    await full.focus();
    await page.keyboard.press('Space');
    await expect(full).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  test('focus moves into the branch and back to Take over', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
    await expect(page.getByText('This is your copy').locator('..')).toBeFocused();
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    await expect(page.getByRole('group', { name: 'Choose a moment' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Choose a moment' })).toBeFocused();
    await page.getByRole('button', { name: 'Back to demo' }).click();
    await expect(page.getByRole('button', { name: 'Take over' })).toBeFocused();
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
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.waitForTimeout(3000);
    await expect(page.getByLabel('Ana share')).toHaveValue('10');
    await expect(page.getByText('with 1 edit the recording never sees')).toBeVisible();
    await expect(slider(page)).toBeDisabled();
  });

  test('a save in the branch runs only the local fixture and makes no request', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
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
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByRole('button', { name: 'Save split' }).click();
    await expect(stage(page).getByRole('alert')).toContainText('120%');
    await expect(page.getByText('This is your copy')).toBeVisible();
  });

  test('Reset my changes returns to the moment of control', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    await page.getByRole('button', { name: 'Reset my changes' }).click();
    await expect(page.getByLabel('Ana share')).toHaveValue('30');
    await expect(page.getByText('and the recording stays as it is')).toBeVisible();
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    await expect(page.getByRole('button', { name: 'Reset my changes' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a branch with no edits returns without losing anything', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByRole('button', { name: 'Back to demo' }).click();
    await expect(page.getByRole('status')).toContainText('with nothing to set aside');
    await expect(page.getByRole('button', { name: 'Bring my copy back' })).toHaveCount(0);
  });

  test('the viewer can return by making the exact authored edit, and is told it matches', async ({ page }) => {
    await page.goto(`${host.url}#t=4000`);
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByRole('radio', { name: 'Percent' }).check({ force: true });
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    const panel = page.getByRole('group', { name: 'Choose a moment' });
    await expect(panel.getByRole('button', { name: /Adjust the split/ })).toContainText('Matches your copy');
    await expect(panel.getByRole('button', { name: /Open the receipt/ })).not.toContainText('Matches');
    await panel.getByRole('button', { name: /Adjust the split/ }).click();
    await expect(page.getByRole('status')).toContainText('with nothing to set aside');
  });

  test('choosing a chapter brings the story back into view', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    const panel = page.getByRole('group', { name: 'Choose a moment' });
    await panel.getByRole('button', { name: /Inspect the balances/ }).click();
    await expect(page.locator('.reel-frame')).toBeInViewport({ ratio: 0.9 });
    await expect(page.getByRole('button', { name: 'Take over' })).toBeFocused();
    await context.close();
  });

  test('the address never holds viewer content', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).click();
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
    await expect(page.getByRole('button', { name: 'Full view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const transition = await page.locator('.reel-scene').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toBe('0s');
    await context.close();
  });

  test('the poster shows the whole scene until the story moves', async ({ page }) => {
    await page.goto(host.url);
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    // The poster is late in the story, and Play starts the story from the beginning.
    expect(Number(await slider(page).inputValue())).toBeLessThan(5000);
  });

  test('Copy link copies the address of this moment and leaves the page where it is', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`${host.url}#t=6000`);
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${host.url}#t=6000`);
    await expect(page.getByRole('status')).toContainText('Link to 0:06 copied');
  });

  test('camera shots frame a target, and Full view turns them off', async ({ page }) => {
    await page.goto(`${host.url}#t=6000`);
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'framed');
    await page.getByRole('button', { name: 'Full view' }).click();
    await expect(page.locator('.reel-scene')).toHaveAttribute('data-camera', 'full');
  });

  test('a caption sits beside its target and covers none of it', async ({ page }) => {
    for (const [t, target] of [
      [2000, 'expense-list'],
      [6000, 'split-editor'],
      [14000, 'split-editor'],
    ] as const) {
      await page.goto(`${host.url}#t=${t}`);
      await page.reload();
      const caption = (await page.locator('.reel-caption').boundingBox())!;
      const about = (await page.locator(`[data-reel-target="${target}"]`).boundingBox())!;
      const apart =
        caption.x + caption.width <= about.x + 1 ||
        caption.x >= about.x + about.width - 1 ||
        caption.y + caption.height <= about.y + 1 ||
        caption.y >= about.y + about.height - 1;
      expect(apart, `caption at ${t}`).toBe(true);
      const frame = (await page.locator('.reel-frame').boundingBox())!;
      expect(caption.x).toBeGreaterThanOrEqual(frame.x);
      expect(caption.x + caption.width).toBeLessThanOrEqual(frame.x + frame.width);
    }
  });

  test('the drawn pointer is on a control as its command happens', async ({ page }) => {
    // Each command of the recording, and the control it presses.
    const presses = [
      [4600, page.getByRole('radio', { name: 'Percent' }).locator('..')],
      [7400, page.getByLabel('Theo share').locator('..')],
      [10400, page.getByRole('button', { name: 'Save split' })],
      [18200, stage(page).getByRole('button', { name: 'Balances' })],
    ] as const;
    await page.goto(host.url);
    for (const [t, control] of presses) {
      await slider(page).fill(String(t));
      await expect(page.locator('.reel-bar')).toHaveAttribute('data-state-t', String(t));
      const tip = (await page.locator('.reel-frame > .reel-cursor').boundingBox())!;
      const box = (await control.boundingBox())!;
      expect(tip.x, `x at ${t}`).toBeGreaterThanOrEqual(box.x);
      expect(tip.x, `x at ${t}`).toBeLessThanOrEqual(box.x + box.width);
      expect(tip.y, `y at ${t}`).toBeGreaterThanOrEqual(box.y);
      expect(tip.y, `y at ${t}`).toBeLessThanOrEqual(box.y + box.height);
    }
    // It is drawn from the log, so the same time always gives the same place.
    await slider(page).fill('9000');
    await expect(page.getByLabel('Ana share')).toHaveValue('30');
    // The camera took half a second to join the story after the first seek, and has settled.
    await page.waitForTimeout(700);
    const once = (await page.locator('.reel-frame > .reel-cursor').getAttribute('style'))!;
    await slider(page).fill('3000');
    await expect(page.getByLabel('Ana share')).toHaveCount(0);
    await slider(page).fill('9000');
    await expect(page.locator('.reel-frame > .reel-cursor')).toHaveAttribute('style', once);
  });

  test('a seek into the middle of a camera move shows the middle of that move', async ({ page }) => {
    const zoom = async () =>
      Number(/scale\(([\d.]+)\)/.exec((await page.locator('.reel-scene').getAttribute('style'))!)![1]);
    await page.goto(`${host.url}#t=4000`);
    const wide = await zoom();
    await slider(page).fill('7000');
    const close = await zoom();
    await slider(page).fill('5000');
    const between = await zoom();
    expect(close).toBeGreaterThan(wide);
    expect(between).toBeGreaterThan(wide);
    expect(between).toBeLessThan(close);
  });

  test('taking over keeps the framed camera, so nothing moves', async ({ page }) => {
    await page.goto(`${host.url}#t=6000`);
    const scene = page.locator('.reel-scene');
    const before = await scene.getAttribute('style');
    await page.getByRole('button', { name: 'Take over' }).click();
    await expect(page.getByText('This is your copy')).toBeVisible();
    expect(await scene.getAttribute('style')).toBe(before);
  });
});

test.describe('what a recording of state allows', () => {
  /** Moves the mouse onto the timeline's line at a time of the story. */
  async function hoverAt(page: Page, t: number) {
    const track = (await page.locator('.reel-track').boundingBox())!;
    const rail = (await page.locator('.reel-slider').boundingBox())!;
    await page.mouse.move(track.x + 8 + (track.width - 16) * (t / 22_000), rail.y + rail.height / 2);
  }

  test('the timeline draws the app at any moment from its state, with no picture stored', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (request) => seen.push(request.url()));
    await page.goto(`${host.url}#t=9000`);
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
    seen.length = 0;
    await hoverAt(page, 20_000);
    const peek = page.locator('.reel-peek');
    await expect(peek.getByRole('heading', { name: 'Who owes what', includeHidden: true })).toHaveCount(1);
    await expect(peek).toContainText('Inspect the balances');
    await expect(peek.locator('.reel-change')).not.toHaveCount(0);
    await hoverAt(page, 2000);
    await expect(peek).toContainText('Opened Harbor Noodle Bar');
    // Nothing was fetched for either moment, and the story has not moved.
    expect(seen).toEqual([]);
    await expect(slider(page)).toHaveValue('9000');
    await page.mouse.move(4, 4);
    await expect(peek).toHaveCount(0);
  });

  test('the look ahead goes away while the line is being dragged, since the stage is then the moment', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await hoverAt(page, 12_000);
    await expect(page.locator('.reel-peek')).toHaveCount(1);
    await page.mouse.down();
    await expect(page.locator('.reel-peek')).toHaveCount(0);
    await page.mouse.up();
  });

  test('Compare holds a moment and lists what differs from it, by key as well as by button', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.locator('h1').click();
    await page.keyboard.press('c');
    const panel = page.getByRole('complementary', { name: 'What changed' });
    await expect(panel).toContainText('Held at 0:09');
    await page.keyboard.press(']');
    await expect(slider(page)).toHaveValue('10400');
    await expect(panel.locator('.reel-change', { hasText: 'Save' })).toContainText('Refused');
    await expect(page.locator('.reel-mark')).not.toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Holding 0:09');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.reel-mark')).toHaveCount(0);
  });

  test('a held moment is let go when the viewer takes over, and their copy has a comparison of its own', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Compare' }).click();
    await page.getByRole('button', { name: 'Take over' }).click();
    await expect(page.getByRole('complementary', { name: 'What changed' })).toHaveCount(0);
    await page.getByLabel('Ana share').fill('10');
    await page.getByRole('button', { name: 'What changed' }).click();
    await expect(page.getByRole('complementary', { name: 'What changed' })).toContainText('The recording at 0:09');
    await expect(page.locator('.reel-apart')).toContainText('differs from the recording in');
  });

  test('a typed value is drawn key by key over its field, and the field keeps the state value', async ({ page }) => {
    await page.goto(host.url);
    // Theo's share becomes 40 at 7400.
    await slider(page).fill('7380');
    await expect(page.locator('.reel-typed')).toHaveText('4');
    await expect(page.getByLabel('Theo share')).not.toHaveValue('40');
    await slider(page).fill('7400');
    await expect(page.locator('.reel-typed')).toHaveCount(0);
    await expect(page.getByLabel('Theo share')).toHaveValue('40');
  });

  test('the drawn button goes down before a command and is up again soon after', async ({ page }) => {
    const press = () =>
      page.locator('.reel-frame > .reel-cursor').evaluate((element) => Number((element as HTMLElement).style.getPropertyValue('--press')));
    await page.goto(host.url);
    await slider(page).fill('10000');
    expect(await press()).toBe(0);
    await slider(page).fill('10390');
    expect(await press()).toBeGreaterThan(0.9);
    await expect(page.locator('.reel-press')).toHaveCount(1);
    await slider(page).fill('10800');
    expect(await press()).toBe(0);
    await expect(page.locator('.reel-press')).toHaveCount(0);
  });

  test('the story ends on a card with what to do next', async ({ page }) => {
    await page.goto(host.url);
    await slider(page).fill('22000');
    const end = page.locator('.reel-end');
    await expect(end.getByRole('heading', { name: 'Fix a shared receipt' })).toBeVisible();
    await expect(end.locator('.control')).toHaveText(['Try it yourself', 'Watch again']);
    await end.getByRole('button', { name: 'Watch again' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('the keys are listed on a sheet that takes focus and gives it back', async ({ page }) => {
    await page.goto(`${host.url}#t=9000`);
    const button = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await button.click();
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeFocused();
    await expect(sheet).toContainText('Hold this moment and compare');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(button).toBeFocused();
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
      await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const layout = await page.locator('.reel-stage').getAttribute('data-layout');
      expect(layout).toBe(width < 600 ? 'narrow' : 'wide');
      if (width < 600) {
        // The caption keeps a readable size in the title bar above the scene.
        const size = await page.locator('.reel-narration').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(15);
        await expect(page.locator('.reel-narration')).toContainText('Ana');
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
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.getByLabel('Ana share').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Ana share')).toBeInViewport();
    await context.close();
  });

  test('the viewer works by touch on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${host.url}#t=9000`);
    await page.getByRole('button', { name: 'Take over' }).tap();
    await page.getByLabel('Ana share').tap();
    await page.getByLabel('Ana share').fill('10');
    await expect(page.getByText('with 1 edit the recording never sees')).toBeVisible();
    for (const name of ['Choose a moment', 'Back to demo']) {
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
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // On a wide stage the chapter names cannot all fit, so each keeps to its own chapter.
    await page.setViewportSize({ width: 1440, height: 900 });
    const track = (await page.locator('.reel-track').boundingBox())!;
    for (const name of await page.locator('.reel-chapter').all()) {
      const box = (await name.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(track.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(track.x + track.width + 1);
    }
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
    await expect(page.getByRole('alert')).toContainText('this build has v1');
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
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
    expect(await scan(page)).toEqual([]);
    // With a moment held, the list of changes open and the keys on their sheet.
    await page.getByRole('button', { name: 'Compare' }).click();
    await slider(page).fill('20000');
    await expect(page.getByRole('complementary', { name: 'What changed' })).toBeVisible();
    // The pressed control takes a moment to reach its colours, and a scan in between misreads them.
    await page.waitForTimeout(300);
    expect(await scan(page)).toEqual([]);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    expect(await scan(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Compare' }).click();
    // On the card the story ends with.
    await slider(page).fill('22000');
    await expect(page.locator('.reel-end')).toBeVisible();
    // The card fades in, and the controls under it are changing colour as it does.
    await page.waitForTimeout(700);
    expect(await scan(page)).toEqual([]);
    await slider(page).fill('14000');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Take over' }).click();
    expect(await scan(page)).toEqual([]);
    await page.getByRole('button', { name: 'Choose a moment' }).click();
    expect(await scan(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to demo' }).click();
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
