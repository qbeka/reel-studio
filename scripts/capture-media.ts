/**
 * Captures the README cover, the poster and two screen recordings from the real
 * exported viewer and the real editor. Run after `pnpm build` and an export of the release
 * project to exports/release.
 *
 *   pnpm exec tsx scripts/capture-media.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from '@playwright/test';
import { serveStatic } from './static-server';

const OUT = 'docs/media';
const PORT = 4340;
const EDITOR_PORT = 5178;
const SIZE = { width: 1280, height: 800 };

await mkdir(OUT, { recursive: true });
const server = await serveStatic('exports/release', PORT);
const editor = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(EDITOR_PORT), '--strictPort'], { stdio: 'ignore' });
const viewerUrl = `http://127.0.0.1:${PORT}/`;

/** Video capture shows no pointer, so draw one for the viewer of the recording. */
const cursor = `
  const start = () => {
    const dot = document.createElement('div');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = 'position:fixed;z-index:9999;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#1d3a2acc;border:2px solid #fff;pointer-events:none;left:-40px;top:-40px;transition:left .35s ease,top .35s ease';
    document.documentElement.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  };
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);
`;

async function record(browser: Browser, name: string, script: (page: Page) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'reel-video-'));
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
  });
  await context.addInitScript(cursor);
  const page = await context.newPage();
  await script(page);
  await context.close();
  const [file] = await readdir(dir);
  const target = join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', join(dir, file!),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    target,
  ]);
  await rm(dir, { recursive: true, force: true });
}

async function click(page: Page, locator: ReturnType<Page['getByRole']>) {
  const box = await locator.boundingBox();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(380);
  }
  await locator.click();
}

async function type(page: Page, label: string, value: string) {
  const field = page.getByLabel(label);
  await click(page, field as never);
  await field.selectText();
  await page.keyboard.type(value, { delay: 140 });
}

/** A plain text note over the page, used to label steps in the walkthrough. */
async function note(page: Page, text: string, ms: number) {
  await page.evaluate((message) => {
    let el = document.getElementById('walk-note');
    if (el === null) {
      el = document.createElement('div');
      el.id = 'walk-note';
      el.style.cssText = "position:fixed;z-index:9998;left:50%;bottom:18px;translate:-50% 0;max-width:80%;padding:9px 16px;background:#111511ee;color:#fbf8f4;border-radius:8px;font:17px/1.3 Georgia,serif;text-align:center;pointer-events:none";
      document.body.append(el);
    }
    el.textContent = message;
  }, text);
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch();

/* Stills ------------------------------------------------------------------------------ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  await page.goto(`${viewerUrl}#t=8500`);
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByLabel('Ana share').fill('10');
  await page.getByLabel('Theo share').fill('30');
  await page.getByLabel('Mina share').fill('60');
  await page.getByLabel('Mina share').blur();
  await page.waitForTimeout(200);
  // A narrower column of the real layout, so the title, the recomputed balances and the
  // fork all fit in the 2:1 frame GitHub uses for a cover.
  await page.evaluate(() => {
    document.querySelector('.reel-viewer')?.setAttribute('style', 'max-width:800px;padding-top:12px');
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, 'cover.png') });
  await page.close();

  const poster = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await poster.goto(`${viewerUrl}embed.html`);
  await poster.waitForTimeout(300);
  await poster.screenshot({ path: join(OUT, 'poster.png') });
  await poster.close();
}

/* Signature interaction, 15 to 25 seconds ----------------------------------------------- */
await record(browser, 'demo', async (page) => {
  await page.goto(`${viewerUrl}#t=5800`);
  await page.getByRole('button', { name: 'Try it' }).waitFor();
  await page.waitForTimeout(700);
  await click(page, page.getByRole('button', { name: 'Play', exact: true }));
  await page.waitForTimeout(2300);
  await click(page, page.getByRole('button', { name: 'Try it' }));
  await page.waitForTimeout(1200);
  await type(page, 'Mina share', '60');
  await page.waitForTimeout(500);
  await type(page, 'Theo share', '30');
  await page.waitForTimeout(500);
  await type(page, 'Ana share', '10');
  await page.waitForTimeout(1800);
  await click(page, page.getByRole('button', { name: 'Return to story' }));
  await page.waitForTimeout(1600);
  await click(page, page.getByRole('group', { name: 'Return to the story' }).getByRole('button', { name: /Inspect the balances/ }));
  await page.waitForTimeout(1800);
  await click(page, page.getByRole('button', { name: 'Play', exact: true }));
  await page.waitForTimeout(2500);
});

/* Technical walkthrough, 60 to 90 seconds ------------------------------------------------ */
await record(browser, 'walkthrough', async (page) => {
  const editorUrl = `http://127.0.0.1:${EDITOR_PORT}/`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(editorUrl).then((r) => r.ok).catch(() => false)) break;
    await page.waitForTimeout(100);
  }
  await page.goto(editorUrl);
  await note(page, 'Reel records from scenes that declare their commands. It does not record pixels.', 5000);
  await click(page, page.getByRole('button', { name: /^Retry queue/ }));
  await note(page, 'This is the second registered scene: a delivery queue with a failing endpoint.', 4500);
  await click(page, page.getByRole('button', { name: 'Record' }));
  await click(page, page.getByRole('button', { name: 'Send an event' }));
  await note(page, 'Each attempt is an outcome in the log, so playback never calls anything.', 3800);
  await click(page, page.getByRole('radio', { name: 'Healthy (200)' }));
  await note(page, 'The endpoint recovers, and the waiting job delivers on its next attempt.', 3400);
  await click(page, page.getByRole('button', { name: 'Stop' }));
  await note(page, 'Commands appear on the timeline. Filled ticks are input and hollow ticks are outcomes.', 4200);
  await click(page, page.locator('.ed-command').first() as never);
  await note(page, 'The inspector shows the recorded command and its payload.', 3000);
  await click(page, page.getByRole('button', { name: 'Delete command' }));
  await note(page, 'Later commands depend on this one, so Reel shows the repair step.', 4000);
  await click(page, page.getByRole('button', { name: 'Cancel the edit' }));
  await page.goto(`${viewerUrl}`);
  await page.getByRole('button', { name: 'Try it' }).waitFor();
  await note(page, 'The export is a static folder, here on a plain file server.', 3200);
  await page.getByRole('slider', { name: 'Story position' }).fill('10500');
  await note(page, 'Seeking restores a checkpoint and replays to the exact time.', 3200);
  await page.getByRole('slider', { name: 'Story position' }).fill('3000');
  await page.waitForTimeout(700);
  await page.getByRole('slider', { name: 'Story position' }).fill('15000');
  await page.waitForTimeout(700);
  await page.getByRole('slider', { name: 'Story position' }).fill('8500');
  await note(page, 'Each state is checked against a full replay and an independent money model.', 3600);
  await click(page, page.getByRole('button', { name: 'Try it' }));
  await note(page, 'Try it forks the state in place. Nothing here touches the recording.', 3600);
  await type(page, 'Ana share', '10');
  await note(page, 'The balances recompute from the whole ledger.', 3400);
  await click(page, page.getByRole('button', { name: 'Return to story' }));
  await note(page, 'Return restores a recorded moment, and says what it clears. States are never merged.', 4400);
  await click(page, page.getByRole('group', { name: 'Return to the story' }).getByRole('button', { name: /Correct the shares/ }));
  await note(page, 'The story resumes from a chapter, and the viewer can still bring their copy back.', 5500);
});

await browser.close();
server.closeAllConnections();
server.close();
editor.kill();
for (const name of ['demo', 'walkthrough']) {
  const duration = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, `${name}.mp4`)]);
  console.log(`${name}.mp4: ${Number(duration.toString()).toFixed(1)} s`);
}
process.exit(0);
