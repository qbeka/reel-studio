/**
 * Draws the share card for the project page: plain paper, the name, the one sentence, and
 * the recording's own timeline with a copy forking away from it. The chapters and the
 * command dots sit where they do in the recording the page plays.
 *
 *   pnpm exec tsx scripts/og.ts
 */
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { type ReelProject, playRange } from '../src/core/project';

const OUT = 'public/og.png';
const project = JSON.parse(await readFile('projects/receipt-split-release.reel.json', 'utf8')) as ReelProject;
const { start, end } = playRange(project);

const font = async (file: string) => (await readFile(`src/assets/fonts/${file}`)).toString('base64');
const serif = await font('GeistSerif-Regular.woff2');
const sans = await font('Geist-Medium.woff2');

const LEFT = 84;
const RIGHT = 1116;
const Y = 452;
const x = (t: number) => LEFT + ((t - start) / (end - start)) * (RIGHT - LEFT);
const cuts = [start, ...project.chapters.map((c) => c.t).filter((t) => t > start && t < end), end];
const now = project.commands[5]!.t + 900;
const at = x(now);

const parts = cuts
  .slice(0, -1)
  .map((from, i) => {
    const a = x(from) + (i > 0 ? 5 : 0);
    const b = x(cuts[i + 1]!) - (i < cuts.length - 2 ? 5 : 0);
    const done = Math.max(a, Math.min(b, at));
    return `<rect x="${a}" y="${Y - 7}" width="${b - a}" height="14" rx="7" fill="#11151124"/>${
      done > a ? `<rect x="${a}" y="${Y - 7}" width="${done - a}" height="14" rx="7" fill="#111511"/>` : ''
    }<text x="${a + 2}" y="${Y - 30}" class="n">${i + 1}</text>`;
  })
  .join('');
const dots = project.commands
  .map((c) => `<circle cx="${x(c.t)}" cy="${Y + 28}" r="5.5" fill="${c.t <= now ? '#111511' : '#8d918e'}"/>`)
  .join('');
const mine = Y + 78;
const fork = `<path d="M ${at} ${Y} C ${at + 46} ${Y}, ${at + 46} ${mine}, ${at + 92} ${mine} L ${at + 330} ${mine}" fill="none" stroke="#1d3a2a" stroke-width="6" stroke-linecap="round"/>
<circle cx="${at + 150}" cy="${mine}" r="9" fill="#1d3a2a" stroke="#fff" stroke-width="4"/>
<circle cx="${at + 214}" cy="${mine}" r="9" fill="#1d3a2a" stroke="#fff" stroke-width="4"/>
<circle cx="${at + 330}" cy="${mine}" r="13" fill="#fff" stroke="#1d3a2a" stroke-width="6"/>
<text x="${at + 358}" y="${mine + 11}" class="c">Your copy</text>`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: S; src: url(data:font/woff2;base64,${serif}); }
@font-face { font-family: G; src: url(data:font/woff2;base64,${sans}); font-weight: 500; }
html, body { margin: 0; width: 1200px; height: 630px; background: #fff; }
h1 { position: absolute; left: ${LEFT - 8}px; top: 62px; margin: 0; font: 400 168px/1 S; letter-spacing: -0.04em; color: #111511; }
p { position: absolute; left: ${LEFT}px; top: 252px; margin: 0; font: 400 50px/1.1 S; letter-spacing: -0.02em; color: #444944; }
svg { position: absolute; inset: 0; }
.n { font: 500 30px/1 G; fill: #535753; }
.c { font: 500 34px/1 G; fill: #1d3a2a; }
</style><h1>Reel</h1><p>A product demo you can actually use</p>
<svg width="1200" height="630" viewBox="0 0 1200 630">${parts}${dots}${fork}
<circle cx="${at}" cy="${Y}" r="17" fill="#fff" stroke="#111511" stroke-width="10"/></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT });
await browser.close();
console.log(`Wrote ${OUT}.`);
