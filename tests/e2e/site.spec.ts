import { execFileSync } from 'node:child_process';
import { type Locator, type Page, expect, test } from '@playwright/test';
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

/**
 * The stage. The page also draws the same app small, in the look ahead and in its figures,
 * so everything a test presses or reads is looked for here and nowhere else.
 */
const stage = (page: Page) => page.locator('#stage');
const app = (page: Page) => page.locator('#stage .reel-scene');

const open = async (page: Page, query = '') => {
  await page.goto(`${host.url}${query}`);
  await expect(stage(page).getByRole('button', { name: 'Take over' })).toBeVisible();
};

/** The scene's markup. Controls only a viewer can use are in it from the start, but hidden. */
const scene = (page: Page) =>
  app(page).evaluate((element) => element.innerHTML.replaceAll('data-idle="true"', '').replaceAll('data-idle="false"', ''));

const slider = (page: Page) => stage(page).getByRole('slider', { name: 'Story position' });

/** Moves the mouse onto the timeline's line at a share of its width. */
async function hoverLine(page: Page, share: number) {
  const track = (await stage(page).locator('.reel-track').boundingBox())!;
  const rail = (await stage(page).locator('.reel-slider').boundingBox())!;
  await page.mouse.move(track.x + 8 + (track.width - 16) * share, rail.y + rail.height / 2);
}

const inside = (inner: { x: number; y: number; width: number; height: number }, outer: typeof inner, slack = 1) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

/** Scrolls the whole page once, so everything below the first screen has arrived. */
async function readToTheEnd(page: Page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 400) {
    await page.evaluate((to) => scrollTo(0, to), y);
    await page.waitForTimeout(60);
  }
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** How long the camera takes to join the story after the first move, with room to spare. */
const CAMERA_SETTLES_MS = 900;

/** The boxes of two parts of the stage, read in the same instant so a moving camera cannot part them. */
const together = (page: Page, first: string, second: string) =>
  page.locator('#stage').evaluate(
    (root, [a, b]) => [a, b].map((selector) => root.querySelector(selector!)!.getBoundingClientRect().toJSON()),
    [first, second],
  ) as Promise<{ x: number; y: number; width: number; height: number }[]>;

test.describe('the first screen', () => {
  test('is a working app at a useful moment', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Reel', level: 1 })).toBeVisible();
    // The name stands alone. The sentence that once sat under it is the share card's.
    await expect(page.locator('.title > p')).toHaveCount(0);
    await expect(page.getByText('A product demo you can actually use')).toHaveCount(0);
    await expect(app(page).locator('.rs-error')).toContainText('120%');
    await expect(stage(page).getByText('Recorded, synthetic data')).toBeVisible();
    await expect(stage(page).getByRole('button', { name: 'Take over' })).toBeInViewport();
  });

  test('shows the whole product, at rest on the refused save', async ({ page }) => {
    await open(page);
    await expect(app(page)).toHaveAttribute('data-camera', 'full');
    await expect(app(page).locator('.rs-wordmark')).toHaveText('Tabkin');
    await expect(app(page).locator('.rs-bar')).toHaveAttribute('data-state', 'over');
    await expect(stage(page).locator('.reel-caption')).toContainText('120%');
    // The drawn pointer rests on the control of the last command, which was the refused save.
    const pointer = await box(stage(page).locator('.reel-frame > .reel-cursor'));
    const save = await box(app(page).getByRole('button', { name: 'Save split' }));
    expect(pointer.x).toBeGreaterThan(save.x);
    expect(pointer.x).toBeLessThan(save.x + save.width);
    expect(pointer.y).toBeGreaterThan(save.y);
    expect(pointer.y).toBeLessThan(save.y + save.height);
  });

  test('fills the lower half of the receipt with what saving would do', async ({ page }) => {
    await open(page);
    const preview = app(page).locator('.rs-preview');
    await expect(preview).toHaveAttribute('data-ready', 'false');
    await expect(preview.locator('.rs-after li')).toHaveCount(3);
    await slider(page).fill('13000');
    await expect(preview).toHaveAttribute('data-ready', 'true');
    await expect(preview.locator('.rs-after li').nth(2)).toContainText('Owed $59.85');
  });

  test('has a share card, a tab icon and no request to another host', async ({ page, request }) => {
    host.requests.length = 0;
    host.watch(page);
    await open(page);
    await readToTheEnd(page);
    const meta = (name: string) => page.locator(`meta[property="${name}"], meta[name="${name}"]`).getAttribute('content');
    expect(await meta('og:title')).toBe('Reel');
    expect(await meta('og:description')).toBe('A product demo you can actually use');
    expect(await meta('og:url')).toBe('https://www.qendrimbeka.com/projects/reel/');
    expect(await meta('og:image')).toBe('https://www.qendrimbeka.com/projects/reel/og.png');
    expect(await meta('twitter:card')).toBe('summary_large_image');
    expect(await meta('twitter:image')).toBe('https://www.qendrimbeka.com/projects/reel/og.png');
    for (const file of ['og.png', 'favicon.svg']) {
      expect((await request.get(`${host.url}${file}`)).status(), file).toBe(200);
    }
    const base = new URL(host.url);
    for (const url of host.requests) expect(new URL(url).host, url).toBe(base.host);
  });
});

test.describe('the story', () => {
  test('Play tells it from its start, and the camera closes in on the split', async ({ page }) => {
    await open(page);
    await stage(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(stage(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(Number(await slider(page).inputValue())).toBeLessThan(4000);
    await stage(page).getByRole('button', { name: 'Pause' }).click();
    await slider(page).fill('7000');
    await expect(app(page)).toHaveAttribute('data-camera', 'framed');
  });

  test('a close shot quiets everything but its subject, and a viewer in control gets it all back', async ({ page }) => {
    await open(page);
    await expect(stage(page).locator('.reel-veil')).toHaveCount(0);
    await slider(page).fill('7000');
    const veil = stage(page).locator('.reel-veil');
    await expect(veil).toHaveCount(1);
    // The clear part is the split editor, with a little room around it.
    await page.waitForTimeout(CAMERA_SETTLES_MS);
    const [clear, subject] = await together(page, '.reel-veil', '.reel-scene [data-reel-target="split-editor"]');
    expect(inside(subject!, clear!)).toBe(true);
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    await expect(stage(page).locator('.reel-veil')).toHaveCount(0);
  });

  test('a caption is set under the picture, and never over the app', async ({ page }) => {
    await open(page);
    for (const t of [2000, 6000, 10600, 14000, 19000]) {
      await slider(page).fill(String(t));
      await expect(stage(page).locator('.reel-bar')).toHaveAttribute('data-state-t', String(t));
      const caption = await box(stage(page).locator('.reel-caption'));
      const window = await box(stage(page).locator('.reel-window'));
      const bar = await box(stage(page).locator('.reel-bar'));
      expect(caption.y, `at ${t}`).toBeGreaterThanOrEqual(window.y + window.height);
      expect(caption.y + caption.height, `at ${t}`).toBeLessThanOrEqual(bar.y + 1);
      expect(caption.x).toBeGreaterThanOrEqual(window.x);
      expect(caption.x + caption.width).toBeLessThanOrEqual(window.x + window.width);
    }
  });

  test('a typed value arrives one key at a time, and the app under it is untouched until its command', async ({ page }) => {
    await open(page);
    // Mina's share becomes 50 at 5735. Shortly before, one key is down.
    await slider(page).fill('5700');
    const typed = stage(page).locator('.reel-typed');
    await expect(typed).toHaveText('5');
    await expect(app(page).getByLabel('Mina share')).not.toHaveValue('50');
    // The letters sit exactly over the field they are for.
    await page.waitForTimeout(CAMERA_SETTLES_MS);
    const [over, field] = await together(page, '.reel-typed', '.reel-scene input[aria-label="Mina share"]');
    expect(Math.abs(over!.x - field!.x)).toBeLessThan(1.5);
    expect(Math.abs(over!.y - field!.y)).toBeLessThan(1.5);
    expect(Math.abs(over!.width - field!.width)).toBeLessThan(1.5);
    // Earlier still the old value is selected, and nothing has been typed.
    await slider(page).fill('5500');
    await expect(typed).toHaveAttribute('data-selecting', 'true');
    // At the command itself the value is in the app, and nothing is drawn over it.
    await slider(page).fill('5735');
    await expect(app(page).getByLabel('Mina share')).toHaveValue('50');
    await expect(typed).toHaveCount(0);
  });

  test('a chapter name jumps to its chapter, and the story ends on a card', async ({ page }) => {
    await open(page);
    await expect(stage(page).locator('.reel-chapter')).toHaveCount(5);
    await stage(page).getByRole('button', { name: '4 Correct the shares' }).click();
    await expect(slider(page)).toHaveValue('12172');
    await expect(stage(page).getByRole('button', { name: '4 Correct the shares' })).toHaveAttribute('aria-current', 'true');

    await expect(stage(page).locator('.reel-end')).toHaveCount(0);
    await slider(page).fill('20000');
    const end = stage(page).locator('.reel-end');
    await expect(end.getByRole('heading', { name: 'Fix a shared receipt' })).toBeVisible();
    await expect(end).toContainText('10 commands played in 0:20');
    await expect(end.locator('.control')).toHaveText(['Try it yourself', 'Watch again', 'Watch the Relaymoth demo']);
    await end.getByRole('button', { name: 'Watch again' }).click();
    await expect(end).toHaveCount(0);
    await expect(stage(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    await stage(page).getByRole('button', { name: 'Pause' }).click();
    expect(Number(await slider(page).inputValue())).toBeLessThan(4000);

    await slider(page).fill('20000');
    await end.getByRole('button', { name: 'Try it yourself' }).click();
    await expect(stage(page).getByText('Live, synthetic data')).toBeVisible();
    await expect(end).toHaveCount(0);
  });

  test('a link to a moment opens the page on that moment', async ({ page }) => {
    await page.goto(`${host.url}#t=16900`);
    await expect(app(page).getByRole('heading', { name: 'Who owes what' })).toBeVisible();
    await expect(slider(page)).toHaveValue('16900');
    // The balances screen says where the numbers come from, receipt by receipt.
    await expect(app(page).locator('.rs-ledger tbody tr')).toHaveCount(3);
    await expect(app(page).locator('.rs-ledger tfoot')).toContainText('+$59.85');
  });

  test('the page keeps its own address and leaves reading keys alone', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Details' }).click();
    // The section opens on its sentence, which is its heading.
    await expect(page.getByRole('heading', { name: /^Reel keeps what happened in an app/, level: 2 })).toBeInViewport();
    await page.keyboard.press('ArrowRight');
    await slider(page).fill('5000');
    expect(new URL(page.url()).hash).toBe('#details');
  });
});

test.describe('looking at a moment without going there', () => {
  test('the timeline draws the app at the moment under the mouse, from its state', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The look ahead answers a mouse, and one engine is enough to check it.');
    await open(page);
    await expect(stage(page).locator('.reel-peek')).toHaveCount(0);
    // Near the end the recording is on its balances screen. The stage is not.
    await hoverLine(page, 0.95);
    const peek = stage(page).locator('.reel-peek');
    await expect(peek.locator('.reel-mini').getByRole('heading', { name: 'Who owes what', includeHidden: true })).toHaveCount(1);
    await expect(app(page).getByRole('heading', { name: 'Who owes what' })).toHaveCount(0);
    await expect(peek).toContainText('Inspect the balances');
    await expect(peek).toContainText('10 of 10');
    // The story has not moved, and the look ahead says what differs from it.
    await expect(slider(page)).toHaveValue('10600');
    await expect(peek.locator('.reel-change').first()).toContainText('Screen');
    await expect(peek.locator('.reel-mini-marks i').first()).toBeAttached();

    // The moment on screen differs from itself in nothing.
    await hoverLine(page, 10_600 / 20_000);
    await expect(peek).toContainText('The same state as the moment on screen');
    await expect(peek.locator('.reel-mini-marks i')).toHaveCount(0);

    // It is the real scene, so it shows exactly what a seek to that moment shows.
    await hoverLine(page, 0.3);
    const small = await peek.locator('.reel-mini-scene').evaluate((element) => element.textContent);
    await page.mouse.move(5, 5);
    await expect(peek).toHaveCount(0);
    await slider(page).fill('6000');
    expect(await app(page).evaluate((element) => element.textContent)).toBe(small);
  });

  test('it takes no part in the app: nothing in it can be pressed, read out or tabbed to', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The look ahead answers a mouse, and one engine is enough to check it.');
    await open(page);
    await hoverLine(page, 0.4);
    const peek = stage(page).locator('.reel-peek');
    await expect(peek).toHaveAttribute('aria-hidden', 'true');
    expect(await peek.locator('.reel-mini-scene').evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    // A radio in the small app must not join the group on the stage and clear its choice.
    await expect(app(page).getByRole('radio', { name: 'Percent' })).toBeChecked();
    await hoverLine(page, 0.15);
    await hoverLine(page, 0.4);
    await expect(app(page).getByRole('radio', { name: 'Percent' })).toBeChecked();
  });
});

test.describe('what changed between two moments', () => {
  test('Compare holds a moment, lists every value that differs and outlines each in the app', async ({ page }) => {
    await open(page);
    await slider(page).fill('9000');
    await stage(page).getByRole('button', { name: 'Compare' }).click();
    const panel = stage(page).getByRole('complementary', { name: 'What changed' });
    await expect(panel).toContainText('Held at 0:09');
    await expect(panel).toContainText('Nothing differs yet');
    await expect(stage(page).locator('.reel-mark')).toHaveCount(0);
    await expect(stage(page).locator('.reel-pin')).toHaveCount(1);

    await slider(page).fill('13000');
    const ana = panel.locator('.reel-change', { hasText: 'Ana share' });
    await expect(ana).toContainText('30%');
    await expect(ana).toContainText('10%');
    await expect(panel.locator('.reel-change', { hasText: 'Shares add up to' })).toContainText('100%');
    // Ana's field is one of the outlined parts. The camera is given time to stop first, and
    // the fields and the outlines are read in one instant, so a camera still moving on a slow
    // machine cannot part them. Until it stops, they are read again.
    await expect(stage(page).locator('.reel-mark').first()).toBeVisible();
    await page.waitForTimeout(CAMERA_SETTLES_MS);
    await expect(async () => {
      const { field, mina, around } = await stage(page).evaluate((root) => {
        const rect = (element: Element) => element.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number };
        return {
          field: rect(root.querySelector('.reel-scene input[aria-label="Ana share"]')!),
          mina: rect(root.querySelector('.reel-scene input[aria-label="Mina share"]')!),
          around: [...root.querySelectorAll('.reel-mark')].map(rect),
        };
      });
      const seen = JSON.stringify({ field, around });
      expect(around.length).toBeGreaterThan(0);
      expect(around.some((mark) => inside(field, mark, 2) && mark.width < field.width * 4), seen).toBe(true);
      // Mina's share did not change, and no outline is drawn tightly around it.
      expect(around.some((mark) => inside(mina, mark, 2) && mark.width < mina.width * 2), seen).toBe(false);
    }).toPass({ timeout: 3000 });

    // A control that keeps its place but is hidden from a viewer of the story is not outlined,
    // though it is disabled in one of the two states and not in the other.
    await slider(page).fill('14300');
    await expect(panel.locator('.reel-change', { hasText: 'Save' })).toContainText('Sending');
    await page.waitForTimeout(CAMERA_SETTLES_MS);
    const [undo] = await together(page, '.reel-scene .rs-quiet', '.reel-scene .rs-quiet');
    const outlines = await stage(page)
      .locator('.reel-mark')
      .evaluateAll((marks) => marks.map((mark) => mark.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));
    expect(outlines.some((mark) => inside(undo!, mark, 4) && mark.width < undo!.width + 12)).toBe(false);

    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);
    await expect(stage(page).locator('.reel-mark')).toHaveCount(0);
  });

  test('the same list says how far a viewer has taken their copy from the recording', async ({ page }) => {
    await open(page);
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    await expect(stage(page).locator('.reel-apart')).toHaveText('Your copy is the same state as the recording at 0:10');
    await app(page).getByLabel('Ana share').fill('10');
    await expect(stage(page).locator('.reel-apart')).toContainText('Your copy differs from the recording in');
    await stage(page).getByRole('button', { name: 'What changed' }).click();
    const panel = stage(page).getByRole('complementary', { name: 'What changed' });
    await expect(panel).toContainText('The recording at 0:10');
    await expect(panel.locator('.reel-change', { hasText: 'Ana share' })).toContainText('10%');
    // Putting the value back is not enough, because the recording was left on a refused
    // save and the copy no longer is. Refusing the same save again makes them one state.
    await app(page).getByLabel('Ana share').fill('30');
    await expect(panel.locator('.reel-change')).toHaveCount(1);
    await expect(panel.locator('.reel-change')).toContainText('Refused');
    await app(page).getByRole('button', { name: 'Save split' }).click();
    await expect(stage(page).locator('.reel-apart')).toHaveText('Your copy is the same state as the recording at 0:10');
    await expect(panel).toContainText('Nothing differs yet');
  });

  test('C holds and lets go, and the keys are listed on the stage', async ({ page }) => {
    await open(page);
    await page.getByRole('heading', { name: 'Reel', level: 1 }).click();
    await page.keyboard.press('c');
    await expect(stage(page).getByRole('complementary', { name: 'What changed' })).toBeVisible();
    await page.keyboard.press('c');
    await expect(stage(page).getByRole('complementary', { name: 'What changed' })).toHaveCount(0);

    await page.keyboard.press('?');
    const keys = stage(page).getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(keys).toBeFocused();
    await expect(keys).toContainText('Hold this moment and compare');
    await page.keyboard.press('Escape');
    await expect(keys).toHaveCount(0);
  });
});

test.describe('taking over', () => {
  test('keeps the exact visible state, and the line forks', async ({ page }) => {
    await open(page);
    await slider(page).fill('13000');
    const before = await scene(page);
    await expect(stage(page).locator('.reel-fork')).toHaveCount(0);
    await expect(stage(page).locator('.reel-frame > .reel-cursor')).toHaveCount(1);
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    await expect(stage(page).getByText('Live, synthetic data')).toBeVisible();
    expect(await scene(page)).toBe(before);
    // The stage stops drawing a pointer, because the viewer's own is now the one that counts.
    await expect(stage(page).locator('.reel-frame > .reel-cursor')).toHaveCount(0);
    await expect(stage(page).locator('.reel-box')).toHaveAttribute('data-mode', 'branch');
    await expect(stage(page).locator('.reel-fork-head')).toHaveCount(1);
    await expect(stage(page).locator('.reel-fork text')).toHaveText('Your copy');
  });

  test('the copy runs beside the recording, with a mark for each thing that happens in it', async ({ page }) => {
    await open(page);
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    await expect(stage(page).locator('.reel-fork-mark')).toHaveCount(0);
    await app(page).getByLabel('Ana share').fill('10');
    await expect(stage(page).locator('.reel-fork-mark[data-made="true"]')).toHaveCount(1);
    await expect(stage(page).locator('.reel-fork text')).toContainText('1 edit');
    // The save is the viewer's, and its answer comes from the app by itself.
    await app(page).getByRole('button', { name: 'Save split' }).click();
    await expect(stage(page).locator('.reel-fork-mark[data-made="false"]')).toHaveCount(1);
    await expect(stage(page).locator('.reel-fork-mark[data-made="true"]')).toHaveCount(2);
    // The recording's own line has not moved.
    await expect(slider(page)).toHaveValue('10600');
    // The controls under the line keep to one row however long the last line is.
    const controls = await box(stage(page).locator('.reel-controls'));
    expect(controls.height).toBeLessThan(60);
  });

  test('a viewer who took over inside a close view can open the rest of the app', async ({ page }) => {
    await open(page);
    await expect(stage(page).getByRole('button', { name: 'Full view' })).toHaveCount(0);
    await slider(page).fill('7000');
    await expect(app(page)).toHaveAttribute('data-camera', 'framed');
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    const full = stage(page).getByRole('button', { name: 'Full view' });
    await full.click();
    await expect(full).toHaveAttribute('aria-pressed', 'true');
    await expect(app(page)).toHaveAttribute('data-camera', 'full');
    await app(page).getByRole('button', { name: 'Corner Grocer' }).click();
    await expect(app(page).locator('.rs-receipt h2')).toHaveText('Corner Grocer');
    await full.click();
    await expect(app(page)).toHaveAttribute('data-camera', 'framed');

    // Back in the story the camera follows its shots again, whatever the copy was left on.
    await full.click();
    await stage(page).getByRole('button', { name: 'Back to demo' }).click();
    await expect(app(page)).toHaveAttribute('data-camera', 'framed');
  });

  test('there is one default way back, and it says what happens to the copy', async ({ page }) => {
    await open(page);
    await stage(page).getByRole('button', { name: 'Take over' }).click();
    await app(page).getByLabel('Ana share').fill('10');
    await expect(stage(page).getByText('with 1 edit the recording never sees')).toBeVisible();
    await expect(stage(page).locator('.control.primary')).toHaveText('Back to demo');
    await stage(page).getByRole('button', { name: 'Back to demo' }).click();

    await expect(stage(page).locator('.reel-narration')).toHaveText(
      'Back at 0:10, with your copy set aside until you take over or leave',
    );
    await expect(app(page).getByLabel('Ana share')).toHaveValue('30');
    await expect(stage(page).locator('.reel-fork text')).toContainText('Set aside');
    await expect(stage(page).locator('.reel-fork-mark')).toHaveCount(1);
    await expect(stage(page).locator('.reel-frame > .reel-cursor')).toHaveCount(1);
    await stage(page).getByRole('button', { name: 'Bring my copy back' }).click();
    await expect(app(page).getByLabel('Ana share')).toHaveValue('10');
    await expect(stage(page).locator('.reel-fork-mark')).toHaveCount(1);
  });
});

test.describe('the second demo', () => {
  test('is a different product in the same player, and the address remembers it', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Relaymoth retries' }).check({ force: true });
    await expect(app(page).locator('.rq')).toBeVisible();
    await expect(stage(page).locator('.reel-window')).toHaveAttribute('data-chrome', 'dark');
    await expect(stage(page).locator('.reel-address')).toHaveText('relaymoth.example/endpoints/orders');
    await expect(stage(page).locator('.reel-chapter')).toHaveCount(5);
    expect(new URL(page.url()).searchParams.get('demo')).toBe('retries');
    await expect(page.getByRole('link', { name: 'Open the exported viewer' }).first()).toHaveAttribute('href', 'demo-retries/');
    // It opens on the dead letter, with the one thing to do about it on screen.
    await expect(app(page).getByRole('button', { name: 'Requeue Event 1', includeHidden: true })).toHaveCount(1);

    await page.reload();
    await expect(app(page).locator('.rq')).toBeVisible();
    await expect(app(page).locator('.rs')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Tabkin receipts' }).check({ force: true });
    await expect(app(page).locator('.rs')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('plays to the end, and its pointer finds the stepper a policy change pressed', async ({ page }) => {
    await open(page, '?demo=retries');
    // The limit goes from 4 to 5 at 8300, by a press on the stepper's plus.
    await slider(page).fill('8300');
    await expect(app(page).getByRole('group', { name: 'Max attempts', includeHidden: true }).locator('.rq-value')).toHaveText('5');
    const pointer = await box(stage(page).locator('.reel-frame > .reel-cursor'));
    const plus = await box(app(page).getByRole('button', { name: 'Raise max attempts', includeHidden: true }));
    expect(pointer.x).toBeGreaterThanOrEqual(plus.x);
    expect(pointer.x).toBeLessThanOrEqual(plus.x + plus.width);
    expect(pointer.y).toBeGreaterThanOrEqual(plus.y);
    expect(pointer.y).toBeLessThanOrEqual(plus.y + plus.height);

    await slider(page).fill('20500');
    await expect(app(page).locator('.rq-counts')).toContainText('2 delivered');
    await expect(stage(page).locator('.reel-end')).toContainText('Rescue a dead letter');
    await stage(page).getByRole('button', { name: 'Try it yourself' }).click();
    await app(page).getByRole('button', { name: 'Send an event' }).click();
    await expect(app(page).getByText('Event 3')).toBeVisible();
    await expect(app(page).locator('.rq-counts')).toContainText('3 delivered');
  });

  test('has an exported viewer of its own', async ({ page }) => {
    await page.goto(`${host.url}demo-retries/`);
    await expect(page.getByRole('heading', { name: 'Rescue a dead letter' })).toBeVisible();
    await expect(page.locator('.rq')).toBeVisible();
    await page.goto(`${host.url}demo-retries/transcript.html`);
    await expect(page.getByText('Event 1 was delivered on attempt 4')).toBeVisible();
  });
});

test.describe('authoring', () => {
  test('turns a command into a chapter and exports a viewer with it', async ({ page }) => {
    await open(page);
    await stage(page).getByRole('button', { name: 'Author' }).click();
    await stage(page).locator('.author-step', { hasText: 'Set Ana to 10%' }).click();
    await stage(page).getByLabel('Chapter that starts at this command').fill('Ana pays less');
    await stage(page).getByLabel('Caption').fill('Her share drops to a tenth.');
    await expect(stage(page).locator('.reel-chapter')).toHaveCount(6);
    await expect(stage(page).locator('.reel-lane-caption')).toHaveCount(5);

    // The camera is a track too. Framing the whole app from here ends the close view early.
    await expect(app(page)).toHaveAttribute('data-camera', 'framed');
    await stage(page).getByLabel('Camera from this command on').selectOption({ label: 'The whole app' });
    await expect(app(page)).toHaveAttribute('data-camera', 'full');

    const download = page.waitForEvent('download');
    await stage(page).getByRole('button', { name: 'Export' }).click();
    expect((await download).suggestedFilename()).toBe('receipt-split-release.zip');
    await expect(stage(page).getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await stage(page).getByRole('button', { name: 'Done' }).click();
    await expect(stage(page).locator('.reel-caption')).toHaveText('Her share drops to a tenth.');
  });
});

test.describe('under the stage', () => {
  test('one figure sets a video against the recording, and draws the app at the moment chosen', async ({ page }) => {
    await open(page);
    const figure = page.locator('#fig-log');
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator('.lanes')).toBeVisible();
    await expect(figure).toContainText('600 pictures');
    await expect(figure).toContainText('10 commands');
    const moment = figure.getByRole('slider', { name: 'Moment in the recording' });
    await moment.fill('0');
    await expect(figure).toContainText('Nothing yet');
    await expect(figure.locator('.log-card[data-kind="video"] .log-big')).toHaveText('Frame 1 of 600');
    await moment.fill('16800');
    await expect(figure.locator('.log-card[data-kind="reel"] .log-big')).toHaveText('Command 10 of 10');
    await expect(figure.locator('.log-code')).toContainText('"type": "setView"');
    await expect(figure.locator('.reel-mini').getByRole('heading', { name: 'Who owes what', includeHidden: true })).toHaveCount(1);
    // The arrow keys move it too.
    await moment.focus();
    await page.keyboard.press('Home');
    await expect(figure.locator('.log-card[data-kind="reel"] .log-big')).toHaveText('Command 0 of 10');
  });

  test('another runs the code behind Take over, and shows the recording never changes', async ({ page }) => {
    await open(page);
    const figure = page.locator('#fig-fork');
    await figure.scrollIntoViewIfNeeded();
    const codes = figure.locator('.fork-steps li code');
    const proof = figure.locator('.fork-proof code');
    const ending = await proof.textContent();
    await expect(codes).toHaveCount(1);
    const moment = await codes.first().textContent();

    await figure.getByRole('button', { name: /^Copy the moment at/ }).click();
    await expect(codes).toHaveCount(2);
    // The copy is the same state as the moment it was taken from.
    await expect(codes.nth(1)).toHaveText(moment!);
    await expect(codes.nth(1)).toHaveAttribute('data-same', 'true');

    await figure.getByRole('button', { name: 'Add a receipt' }).click();
    await expect(codes.nth(1)).toHaveAttribute('data-same', 'false');
    await expect(codes.nth(1)).not.toHaveText(moment!);
    await expect(figure.locator('.fork-said')).toContainText('Added');
    await expect(figure.locator('.reel-mini')).toContainText('4 receipts');
    // The moment and the recording hash exactly as they did before.
    await expect(codes.first()).toHaveText(moment!);
    await expect(proof).toHaveText(ending!);

    await figure.getByRole('button', { name: 'Start again' }).click();
    await expect(codes).toHaveCount(1);
    await expect(figure.locator('.reel-mini')).toContainText('3 receipts');
  });

  test('the measurement is drawn with its baseline, its range and the case where nothing is gained', async ({ page }) => {
    await open(page);
    const figure = page.locator('#fig-seek');
    await figure.scrollIntoViewIfNeeded();
    const panels = figure.locator('.bars');
    await expect(panels).toHaveCount(2);
    await expect(panels.nth(0)).toContainText('20,000 commands');
    await expect(panels.nth(0).locator('.bar')).toHaveCount(2);
    await expect(panels.nth(0).locator('.bar-run')).toHaveCount(10);
    await expect(panels.nth(0)).toContainText('Replay from the start');
    await expect(panels.nth(1)).toContainText('No gain');
    // On its own scale the checkpointed bar is a sliver of the baseline's.
    const widths = async () =>
      Promise.all((await panels.nth(0).locator('.bar-fill').all()).map(async (bar) => (await box(bar)).width));
    const [reel, base] = await widths();
    expect(base! / reel!).toBeGreaterThan(20);
    await figure.getByRole('radio', { name: 'Both on one log scale' }).check({ force: true });
    await expect(async () => {
      const [a, b] = await widths();
      expect(b! / a!).toBeLessThan(4);
    }).toPass();
  });

  test('the seeded failures can be read one by one, with who caught each', async ({ page }) => {
    await open(page);
    const figure = page.locator('#fig-seeded');
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator('.seeded-cell')).toHaveCount(14);
    await expect(figure.locator('.seeded-cell[data-blind="true"]')).toHaveCount(6);
    await figure.locator('.seeded-cell').nth(6).click();
    await expect(figure.locator('.seeded-said')).toContainText('A command exactly at the seek time is left out');
    await expect(figure.locator('.seeded-said')).toContainText('comparison of a seek with a replay');
    await figure.locator('.seeded-cell').nth(0).focus();
    await expect(figure.locator('.seeded-said')).toContainText('separate model of the money');
  });

  test('the embed snippet copies, and the file list is read from the real export', async ({ page, context, browserName }) => {
    await open(page);
    const embed = page.locator('#fig-embed');
    await embed.scrollIntoViewIfNeeded();
    await expect(embed.locator('pre')).toContainText('title="Fix a shared receipt, interactive demo"');
    await expect(embed.locator('pre')).toContainText('embed.html');
    const files = embed.locator('.embed-files li');
    await expect(files).toHaveCount(6);
    await expect(files.nth(2)).toContainText('10 commands');
    // The sizes are the manifest's, so they add up to what the export wrote.
    const manifest = await (await page.request.get(`${host.url}demo/bundle-manifest.json`)).json();
    const poster = manifest.files.find((file: { path: string }) => file.path === 'embed.html').bytes;
    await expect(files.nth(0).locator('b')).toHaveText(`${Math.round(poster / 1000)} KB`);

    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await embed.getByRole('button', { name: 'Copy the snippet' }).click();
      await expect(embed.getByRole('button', { name: 'Copied' })).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain('<iframe');
      expect(copied).toContain('src="/your-folder/embed.html"');
    }
    const download = page.waitForEvent('download');
    await embed.getByRole('button', { name: 'Download the folder as a zip' }).click();
    expect((await download).suggestedFilename()).toBe('receipt-split-release.zip');
  });

  test('ends on places to go, and every link on the page that stays here resolves', async ({ page, request }) => {
    await open(page);
    const onward = page.getByRole('navigation', { name: 'Where to go next' });
    await expect(onward.getByRole('link')).toHaveCount(4);
    const hrefs = await page.locator('a[href]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')!))]);
    // A link from the site root leaves the demo for the rest of the site, like a link to another
    // host, so it is not looked for here. These are the only ones: the way back and the story.
    expect(hrefs.filter((href) => href.startsWith('/')).sort()).toEqual(['/#work-reel', '/work/reel']);
    const local = hrefs.filter((href) => !/^(https?:|#|\/)/.test(href));
    expect(local).toContain('demo/');
    for (const href of local) {
      // Sub-pages are linked as folders, never as a file inside one.
      expect(href, href).not.toMatch(/index\.html$/);
      expect((await request.get(`${host.url}${href}`)).status(), href).toBe(200);
    }
  });
});

test.describe('widths and motion', () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1280, 720],
    [1440, 900],
  ] as const) {
    test(`${width} px has no sideways scroll, and the main action shares a screen with its result`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      for (const query of ['', '?demo=retries']) {
        await open(page, query);
        await expect(stage(page).getByRole('button', { name: 'Take over' })).toBeInViewport();
        await expect(stage(page).locator('.reel-frame')).toBeInViewport({ ratio: 0.5 });
        await readToTheEnd(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, `${query} at ${width}`).toBeLessThanOrEqual(0);
        // The top bar's links end where the bar does, rather than spilling into the gutter, which
        // hides an overflow until an engine sets the same words a pixel or two wider.
        const spill = await page.locator('.topbar').evaluate((bar) => {
          const nav = bar.querySelector('nav')!;
          return nav.getBoundingClientRect().right - bar.getBoundingClientRect().right + Number.parseFloat(getComputedStyle(nav).marginRight);
        });
        expect(spill, `top bar ${query} at ${width}`).toBeLessThanOrEqual(0.5);
        // The same goes for everything under the stage: nothing reaches into the right gutter,
        // unless a part that scrolls or clips holds it.
        const wide = await page.locator('#details').evaluate((details) => {
          const edge = details.getBoundingClientRect().right + 1;
          const held = (element: Element) => {
            for (let node = element.parentElement; node !== null && node !== details; node = node.parentElement) {
              if (getComputedStyle(node).overflowX !== 'visible') return true;
            }
            return false;
          };
          return [...details.querySelectorAll('*')]
            .filter((element) => element.getBoundingClientRect().right > edge && !held(element))
            .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`)
            .slice(0, 5);
        });
        expect(wide, `under the stage ${query} at ${width}`).toEqual([]);
      }
      await context.close();
    });
  }

  test('the first second arrives in order and is over within 700 ms', async ({ page }) => {
    await page.goto(host.url);
    const timing = await page.evaluate(() =>
      ['.title h1', '.title-actions', '.stage'].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { name: style.animationName, ends: (Number.parseFloat(style.animationDelay) + Number.parseFloat(style.animationDuration)) * 1000, delay: Number.parseFloat(style.animationDelay) };
      }),
    );
    for (const part of timing) {
      expect(part.name).not.toBe('none');
      expect(part.ends).toBeLessThanOrEqual(700);
    }
    expect(timing[0]!.delay).toBeLessThan(timing[1]!.delay);
    expect(timing[1]!.delay).toBeLessThan(timing[2]!.delay);
  });

  test('reduced motion gives a still, complete page', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page);
    await readToTheEnd(page);
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    // Nothing waits to be revealed, and the figures are all there.
    expect(await page.locator('[data-reveal]').evaluateAll((parts) => parts.every((part) => getComputedStyle(part).opacity === '1'))).toBe(true);
    await expect(page.locator('#fig-log .lanes')).toBeAttached();
    await expect(page.locator('#fig-seek .bars')).toHaveCount(2);
    // The camera shows the whole app and nothing is veiled.
    await slider(page).fill('7000');
    await expect(app(page)).toHaveAttribute('data-camera', 'full');
    await expect(stage(page).locator('.reel-veil')).toHaveCount(0);
    await context.close();
  });
});
