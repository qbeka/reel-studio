/**
 * Measures seeking in the real exported viewer, in real Chromium, from outside the page.
 * See bench/PROTOCOL.md for the frozen definitions. Every run starts a fresh browser.
 *
 *   pnpm exec tsx bench/run-browser.ts --label draft --runs 1 --workloads short,long,stress
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { serveStatic } from '../scripts/static-server';
import type { ReelProject } from '../src/core/project';
import { parseProject, validateProject } from '../src/core/project';
import { Timeline } from '../src/core/timeline';
import { assembleBundle, bundleSize } from '../src/export/bundle';
import { readTree, writeBundle } from '../src/export/write';
import { receiptAdapter } from '../src/scenes/receipt/adapter';
import type { ReceiptState } from '../src/scenes/receipt/state';
import { WORKLOADS, projectFrom, receiptLog } from './fixtures';
import { positionQuantiles, seededTimes } from './sampling';

const PORT = 4330;
const CHECKPOINT_EVERY = 256;
/** Larger than any log here, so the only stored state is the initial one. */
const NO_CHECKPOINTS = 100_000;

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'draft' },
    runs: { type: 'string', default: '5' },
    workloads: { type: 'string', default: 'short,long,stress' },
    protocol: { type: 'string', default: 'draft' },
  },
});
const RUNS = Number(values.runs);
const NAMES = values.workloads!.split(',');

/** Samples per run. The baseline takes seconds per seek, so it gets fewer. */
const SAMPLES = { warm: 300, warmBaseline: 60, warmup: 40, coldPositions: [0.25, 0.5, 0.75, 1], scrub: 120 };

interface Variant {
  name: 'checkpointed' | 'baseline';
  every: number;
}
const VARIANTS: Variant[] = [
  { name: 'checkpointed', every: CHECKPOINT_EVERY },
  { name: 'baseline', every: NO_CHECKPOINTS },
];

function workloadProject(name: string, every: number, shortProject: ReelProject): ReelProject {
  if (name === 'short') return { ...shortProject, checkpointEvery: every };
  const spec = WORKLOADS[name as keyof typeof WORKLOADS];
  return projectFrom(receiptAdapter, `bench-${name}`, `Bench ${name}`, receiptLog(spec), spec.seed, every);
}

/**
 * What a scene shows, as an ordered list: text, field values and which options are active.
 * This is the whole visible content, so a stale state fails unless it looks identical.
 */
function expectedTokens(state: ReceiptState): string[] {
  const html = renderToStaticMarkup(
    createElement(receiptAdapter.Render, { state, send: () => {}, interactive: false, layout: 'wide' }),
  );
  const decode = (text: string) =>
    text
      .replaceAll('&#x27;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  const tokens: string[] = [];
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const part = match[0];
    if (!part.startsWith('<')) {
      const text = decode(part).trim();
      if (text !== '') tokens.push(text);
      continue;
    }
    if (part.includes('data-active="true"')) tokens.push('[active]');
    const value = part.startsWith('<input') ? /\svalue="([^"]*)"/.exec(part) : null;
    if (value !== null) tokens.push(decode(value[1]!));
  }
  return tokens;
}

/** React writes `2 Mar · $64.18` as three DOM text nodes, so compare the joined text. */
function visibleText(tokens: readonly string[]): string {
  return tokens.join('').replace(/\s+/g, '');
}

const pageHelpers = `
// The same list as expectedTokens, read from the live page.
window.__tokens = () => {
  const tokens = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text !== '') tokens.push(text);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.active === 'true') tokens.push('[active]');
    if (node instanceof HTMLInputElement && node.type !== 'radio') tokens.push(node.value);
    node.childNodes.forEach(walk);
  };
  document.querySelector('.rs').childNodes.forEach(walk);
  return tokens;
};
window.__seek = (value) => new Promise((resolve) => {
  const slider = document.querySelector('.reel-slider');
  const bar = document.querySelector('.reel-bar');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const start = performance.now();
  const channel = new MessageChannel();
  const check = () => {
    if (bar.dataset.t === String(value) && bar.dataset.seeking === 'false') {
      const commit = performance.now() - start;
      requestAnimationFrame(() => {
        const nextFrame = performance.now() - start;
        channel.port1.close();
        resolve({ commit, nextFrame });
      });
    } else {
      channel.port2.postMessage(0);
    }
  };
  channel.port1.onmessage = check;
  set.call(slider, String(value));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  queueMicrotask(check);
});
`;

async function openViewer(browser: Browser, url: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(pageHelpers);
  const start = Date.now();
  await page.goto(url);
  await page.waitForSelector('.reel-slider', { timeout: 120_000 });
  return { context, page, readyMs: Date.now() - start };
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { n: sorted.length, p50: q(0.5), p95: q(0.95), max: sorted.at(-1)! };
}

function git(args: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const runtime = await readTree('dist/viewer');
const parsedShort = parseProject(JSON.parse(await readFile('projects/receipt-split-release.reel.json', 'utf8')));
if (!parsedShort.ok) throw new Error(parsedShort.errors.join(' '));

const stamp = new Date().toISOString().slice(0, 10);
const outDir = join('runs', `${stamp}-${values.label}`);
await mkdir(join(outDir, 'raw'), { recursive: true });

const server = await serveStatic('exports/bench', PORT);
const inputs: Record<string, unknown> = {};

// Export every workload and variant once, and check the fixture before timing anything.
for (const name of NAMES) {
  for (const variant of VARIANTS) {
    const project = workloadProject(name, variant.every, parsedShort.project);
    const issues = validateProject(receiptAdapter, project);
    if (issues.length > 0) throw new Error(`${name}: ${issues[0]!.message}`);
    const files = assembleBundle(project, receiptAdapter, runtime);
    await writeBundle(files, join('exports/bench', name, variant.name));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('bundle-manifest.json')));
    if (variant.name === 'checkpointed') {
      const timeline = new Timeline<ReceiptState>(receiptAdapter, project.commands, {
        seed: project.seed,
        checkpointEvery: project.checkpointEvery,
      });
      const final = timeline.stateAfter(project.commands.length);
      let changed = 0;
      let previous = JSON.stringify(receiptAdapter.serialize(timeline.stateAfter(0)));
      const step = Math.max(1, Math.floor(project.commands.length / 500));
      for (let i = step; i <= project.commands.length; i += step) {
        const current = JSON.stringify(receiptAdapter.serialize(timeline.stateAfter(i)));
        if (current !== previous) changed++;
        previous = current;
      }
      const mix: Record<string, number> = {};
      for (const c of project.commands) mix[c.type] = (mix[c.type] ?? 0) + 1;
      inputs[name] = {
        commands: project.commands.length,
        receipts: final.expenses.length,
        stateBytes: JSON.stringify(receiptAdapter.serialize(final)).length,
        projectBytes: JSON.stringify(project).length,
        projectHash: manifest.projectHash,
        finalStateHash: manifest.finalStateHash,
        checkpointEvery: project.checkpointEvery,
        commandMix: mix,
        sampledChangeRate: changed / Math.floor(project.commands.length / step),
        bundleBytes: bundleSize(files),
      };
    }
  }
}

const results: Record<string, unknown>[] = [];

for (let run = 1; run <= RUNS; run++) {
  for (const name of NAMES) {
    for (const variant of VARIANTS) {
      const url = `http://127.0.0.1:${PORT}/${name}/${variant.name}/`;
      const projectJson = JSON.parse(
        await readFile(join('exports/bench', name, variant.name, 'project.reel.json'), 'utf8'),
      ) as ReelProject;
      const log = projectJson.commands;
      const browser = await chromium.launch();
      const version = browser.version();

      // Cold: a fresh page for each sample, and the first seek after it loads.
      const cold: { position: number; commit: number; nextFrame: number; readyMs: number }[] = [];
      for (const position of SAMPLES.coldPositions) {
        const { context, page, readyMs } = await openViewer(browser, url);
        const t = log[Math.floor((log.length - 1) * position)]!.t;
        const sample = await page.evaluate((v) => (window as any).__seek(v), t);
        cold.push({ position, readyMs, ...sample });
        await context.close();
      }

      // Warm: the same page after a declared warmup.
      const { context, page, readyMs } = await openViewer(browser, url);
      const session = await context.newCDPSession(page);
      const warmupTimes = seededTimes(log, SAMPLES.warmup, 1000 + run);
      await page.evaluate(async (times) => {
        for (const t of times) await (window as any).__seek(t);
      }, warmupTimes);
      await page.evaluate((t) => (window as any).__seek(t), log.at(-1)!.t);

      const count = variant.name === 'baseline' ? SAMPLES.warmBaseline : SAMPLES.warm;
      const times = seededTimes(log, count, 2000 + run);
      const warm: { t: number; commit: number; nextFrame: number }[] = await page.evaluate(
        async (list) => {
          const out = [];
          for (const t of list) out.push({ t, ...(await (window as any).__seek(t)) });
          return out;
        },
        times,
      );

      // Rapid scrub: requests at frame pace, without waiting for each to finish.
      const scrubTimes = seededTimes(log, SAMPLES.scrub, 3000 + run);
      const scrub = await page.evaluate(async (list) => {
        const slider = document.querySelector('.reel-slider') as HTMLInputElement;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        const bar = document.querySelector('.reel-bar') as HTMLElement;
        // `data-t` is the request. `data-state-t` changes only when a state is committed.
        const seen = new Set<string>();
        const observer = new MutationObserver(() => seen.add(bar.dataset.stateT!));
        observer.observe(bar, { attributes: true, attributeFilter: ['data-state-t'] });
        const start = performance.now();
        for (const t of list) {
          set.call(slider, String(t));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        const last = String(list.at(-1));
        while (bar.dataset.t !== last || bar.dataset.seeking !== 'false') {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        observer.disconnect();
        return { requested: list.length, committed: seen.size, totalMs: performance.now() - start, lastT: bar.dataset.t };
      }, scrubTimes);

      // Coherence: the full visible scene must equal a render of a replay here in Node.
      // `staleVisible` counts positions where a state one command old would look different,
      // which is how much power this check has at those positions.
      let coherent = 0;
      let staleVisible = 0;
      const coherence = seededTimes(log, 12, 4000 + run);
      const check = new Timeline<ReceiptState>(receiptAdapter, log, {
        seed: projectJson.seed,
        checkpointEvery: 256,
      });
      for (const t of coherence) {
        await page.evaluate((v) => (window as any).__seek(v), t);
        const count = check.countAt(t);
        const expected = visibleText(expectedTokens(check.stateAfter(count)));
        if (count > 0 && visibleText(expectedTokens(check.stateAfter(count - 1))) !== expected) {
          staleVisible++;
        }
        const shown: string[] = await page.evaluate(() => (window as any).__tokens());
        if (visibleText(shown) === expected) coherent++;
      }

      await session.send('HeapProfiler.collectGarbage');
      const heap = (await session.send('Runtime.getHeapUsage')) as { usedSize: number };
      await context.close();
      await browser.close();

      const warmPositions = positionQuantiles(log, warm.map((s) => s.t));
      const record = {
        run,
        workload: name,
        variant: variant.name,
        browser: version,
        loadAverage: loadavg(),
        readyMs,
        warmup: warmupTimes.length + 1,
        warmPositions,
        warmPositionsInBand: warmPositions.p50 >= 0.4 && warmPositions.p50 <= 0.6,
        cold,
        warm,
        scrub,
        coherentChecks: { passed: coherent, total: coherence.length, staleVisible },
        heapUsedBytes: heap.usedSize,
      };
      await writeFile(
        join(outDir, 'raw', `${name}-${variant.name}-run${run}.json`),
        `${JSON.stringify(record)}\n`,
      );
      const w = stats(warm.map((s) => s.commit));
      const c = stats(cold.map((s) => s.commit));
      console.log(
        `run ${run} ${name}/${variant.name}: ready ${readyMs} ms, warm p50 ${w.p50.toFixed(1)} p95 ${w.p95.toFixed(1)} max ${w.max.toFixed(1)}, cold p95 ${c.p95.toFixed(1)}, scrub ${scrub.committed}/${scrub.requested} in ${scrub.totalMs.toFixed(0)} ms, coherent ${coherent}/${coherence.length}, heap ${(heap.usedSize / 1e6).toFixed(1)} MB, load ${loadavg()[0]!.toFixed(1)}`,
      );
      results.push(record);
    }
  }
}

server.closeAllConnections();
server.close();

const incoherent = results.filter((r) => {
  const c = r.coherentChecks as { passed: number; total: number };
  return c.passed !== c.total;
});

const lock = await readFile('pnpm-lock.yaml');
const manifest = {
  label: values.label,
  protocol: values.protocol,
  commit: git('rev-parse HEAD'),
  // The run writes its own results to runs/, so that folder does not count.
  dirty: git("status --porcelain -- . ':!runs'").length > 0,
  // Relative, so a run folder never carries a path from the machine that made it.
  command: [relative(process.cwd(), process.argv[1]!), ...process.argv.slice(2)].join(' '),
  date: new Date().toISOString(),
  browser: { name: 'chromium', version: (results[0] as { browser: string }).browser, headless: true },
  node: process.version,
  dependencies: { ...packageJson.dependencies, ...packageJson.devDependencies },
  lockfileSha256: createHash('sha256').update(lock).digest('hex'),
  os: { platform: platform(), release: release(), arch: arch() },
  hardware: { cpu: cpus()[0]?.model, logicalCores: cpus().length, memoryBytes: totalmem() },
  power: execSync('pmset -g batt | head -1', { encoding: 'utf8' }).trim(),
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  seedBases: { warmup: 1000, warm: 2000, scrub: 3000, coherence: 4000 },
  repetitions: RUNS,
  samples: SAMPLES,
  exclusions: 'None. Every sample is kept in raw/.',
  inputs,
};
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Saved to ${outDir}`);
if (incoherent.length > 0) {
  console.error(`${incoherent.length} runs failed the coherence check. This result is invalid.`);
  process.exit(1);
}
