/**
 * Writes the numbers the project page shows, from the measured run they come from, and
 * puts the same numbers into the page's own text. The page never holds a figure that is
 * not in the run folder named here. `tests/unit/site-claims.test.ts` checks that both are
 * still in step with the run.
 *
 *   pnpm exec tsx scripts/site-data.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The run every number on the page comes from. */
export const CLAIMS_RUN = 'runs/2026-11-10-pass2';

interface Across {
  median: number;
  min: number;
  max: number;
  perRun: number[];
}
interface SummaryRow {
  workload: string;
  variant: string;
  warmP95Ms: Across;
  coldWorstMs: Across;
  loadAverage1m: Across;
}
interface Control {
  id: string;
  group: string;
  description: string;
  detectedBy: string;
  detected: boolean;
  seekCheckBlind?: boolean;
}

export interface SiteClaims {
  run: { folder: string; date: string; commit: string; machine: string; loadMin: number; loadMax: number };
  seek: Record<'stress' | 'short', { commands: number; checkpointed: Across; baseline: Across }>;
  firstSeek: Across;
  correctness: {
    positions: number;
    mismatches: number;
    logs: { scene: string; workload: string; commands: number; positions: number; mismatches: number }[];
    controls: { id: string; group: string; description: string; detectedBy: string; detected: boolean; blind: boolean }[];
  };
  viewerGzipBytes: number;
}

const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;

export async function buildClaims(run = CLAIMS_RUN): Promise<SiteClaims> {
  const summary = await json<SummaryRow[]>(join(run, 'summary.json'));
  const manifest = await json<{ commit: string; date: string; hardware: { cpu: string }; inputs: Record<string, { commands: number }> }>(
    join(run, 'manifest.json'),
  );
  const correctness = await json<{ seeks: { scene: string; workload: string; commands: number; positions: number; mismatches: number }[]; controls: Control[] }>(
    join(run, 'correctness.json'),
  );
  const sizes = await json<{ workload: string; codeGzipBytes: number }[]>(join(run, 'export.json'));
  const row = (workload: string, variant: string) => {
    const found = summary.find((r) => r.workload === workload && r.variant === variant);
    if (found === undefined) throw new Error(`The run has no ${workload} ${variant} row.`);
    return found;
  };
  const pick = ({ median, min, max, perRun }: Across): Across => ({ median, min, max, perRun });
  const loads = summary.flatMap((r) => r.loadAverage1m.perRun);
  return {
    run: {
      folder: run,
      date: manifest.date.slice(0, 10),
      commit: manifest.commit.slice(0, 7),
      machine: manifest.hardware.cpu,
      loadMin: Math.round(Math.min(...loads)),
      loadMax: Math.round(Math.max(...loads)),
    },
    seek: {
      stress: {
        commands: manifest.inputs.stress!.commands,
        checkpointed: pick(row('stress', 'checkpointed').warmP95Ms),
        baseline: pick(row('stress', 'baseline').warmP95Ms),
      },
      short: {
        commands: manifest.inputs.short!.commands,
        checkpointed: pick(row('short', 'checkpointed').warmP95Ms),
        baseline: pick(row('short', 'baseline').warmP95Ms),
      },
    },
    firstSeek: pick(row('stress', 'checkpointed').coldWorstMs),
    correctness: {
      positions: correctness.seeks.reduce((n, s) => n + s.positions, 0),
      mismatches: correctness.seeks.reduce((n, s) => n + s.mismatches, 0),
      logs: correctness.seeks.map(({ scene, workload, commands, positions, mismatches }) => ({ scene, workload, commands, positions, mismatches })),
      controls: correctness.controls.map((c) => ({
        id: c.id,
        group: c.group,
        description: c.description,
        detectedBy: c.detectedBy,
        detected: c.detected,
        blind: c.seekCheckBlind === true,
      })),
    },
    viewerGzipBytes: sizes[0]!.codeGzipBytes,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A time as the page writes it: 3.2, 22 or 1,074. */
export function ms(value: number): string {
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toLocaleString('en-US');
}

/** Every number the page's text quotes, by the name its markup gives it. */
export function claimText(claims: SiteClaims): Record<string, string> {
  const { stress, short } = claims.seek;
  const [year, month, day] = claims.run.date.split('-').map(Number) as [number, number, number];
  const caught = claims.correctness.controls.filter((c) => c.detected).length;
  const blind = claims.correctness.controls.filter((c) => c.blind);
  return {
    'stress.p95': ms(stress.checkpointed.median),
    'stress.min': stress.checkpointed.min.toFixed(1),
    'stress.max': stress.checkpointed.max.toFixed(1),
    'stress.baseline': ms(stress.baseline.median),
    'stress.baseline.min': ms(stress.baseline.min),
    'stress.baseline.max': ms(stress.baseline.max),
    'stress.commands': stress.commands.toLocaleString('en-US'),
    'short.p95': ms(short.checkpointed.median),
    'short.baseline': ms(short.baseline.median),
    'short.commands': String(short.commands),
    'first.seek': (claims.firstSeek.median / 1000).toFixed(1),
    positions: claims.correctness.positions.toLocaleString('en-US'),
    mismatches: String(claims.correctness.mismatches),
    logs: String(claims.correctness.logs.length),
    'controls.caught': String(caught),
    'controls.total': String(claims.correctness.controls.length),
    'blind.caught': String(blind.filter((c) => c.detected).length),
    'blind.total': String(blind.length),
    'viewer.kb': String(Math.round(claims.viewerGzipBytes / 1000)),
    'run.date': `${day} ${MONTHS[month - 1]} ${year}`,
    'run.machine': claims.run.machine,
    'load.min': String(claims.run.loadMin),
    'load.max': String(claims.run.loadMax),
  };
}

const SPAN = /(<span data-claim="([a-z0-9.]+)">)([^<]*)(<\/span>)/g;

/** The page with every quoted number replaced by the run's. */
export function fillClaims(html: string, text: Record<string, string>): string {
  return html.replace(SPAN, (_, open: string, name: string, _old: string, close: string) => {
    const value = text[name];
    if (value === undefined) throw new Error(`The page quotes ${name}, which the run does not have.`);
    return `${open}${value}${close}`;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const claims = await buildClaims();
  await writeFile('site/data/claims.json', `${JSON.stringify(claims, null, 2)}\n`);
  const page = await readFile('site/index.html', 'utf8');
  await writeFile('site/index.html', fillClaims(page, claimText(claims)));
  console.log(`Wrote site/data/claims.json and the page's numbers from ${CLAIMS_RUN}.`);
}
