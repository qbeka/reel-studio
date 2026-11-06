import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, validateProject } from '../../src/core/project';
import { MANIFEST_PATH, assembleBundle, escapeHtml } from '../../src/export/bundle';
import { readTree, verifyBundle, writeBundle } from '../../src/export/write';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';

const encode = (text: string) => new TextEncoder().encode(text);

const runtime = new Map<string, Uint8Array>([
  ['viewer.html', encode('<title>Reel demo</title><!--reel:noscript--><script src="./assets/a.js"></script>')],
  ['assets/a.js', encode('console.log(1)')],
  ['assets/a.css', encode('.rs{}')],
]);

let project: Awaited<ReturnType<typeof load>>;
async function load() {
  const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8')));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return parsed.project;
}

beforeAll(async () => {
  project = await load();
});

describe('assembleBundle', () => {
  it('uses a valid fixture', () => {
    expect(validateProject(receiptAdapter, project)).toEqual([]);
  });

  it('produces byte identical bundles from the same inputs', () => {
    const a = assembleBundle(project, receiptAdapter, runtime);
    const b = assembleBundle(project, receiptAdapter, runtime);
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [path, bytes] of a) expect(Buffer.compare(bytes, b.get(path)!), path).toBe(0);
  });

  it('holds the pages a static host needs and uses only relative URLs', () => {
    const files = assembleBundle(project, receiptAdapter, runtime);
    for (const path of ['index.html', 'embed.html', 'transcript.html', 'project.reel.json', MANIFEST_PATH]) {
      expect(files.has(path), path).toBe(true);
    }
    expect(files.has('viewer.html')).toBe(false);
    for (const page of ['index.html', 'embed.html', 'transcript.html']) {
      const html = new TextDecoder().decode(files.get(page));
      expect(html, page).not.toMatch(/(?:src|href)="\/(?!\/)/);
      expect(html, page).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it('gives the embed page no script', () => {
    const files = assembleBundle(project, receiptAdapter, runtime);
    expect(new TextDecoder().decode(files.get('embed.html'))).not.toContain('<script');
    expect(new TextDecoder().decode(files.get('transcript.html'))).not.toContain('<script');
  });

  it('puts the transcript in the page for readers with no JavaScript', () => {
    const files = assembleBundle(project, receiptAdapter, runtime);
    const index = new TextDecoder().decode(files.get('index.html'));
    expect(index).toContain('<noscript>');
    expect(index).toContain('Shares add up to 120%');
  });

  it('escapes project text in every page', () => {
    const hostile = { ...project, title: '<img src=x onerror=alert(1)>' };
    const files = assembleBundle(hostile, receiptAdapter, runtime);
    for (const page of ['index.html', 'embed.html', 'transcript.html']) {
      expect(new TextDecoder().decode(files.get(page)), page).not.toContain('<img src=x');
    }
    expect(escapeHtml(`<a href="'&`)).toBe('&lt;a href=&quot;&#39;&amp;');
  });
});

describe('writeBundle', () => {
  async function workspace() {
    const dir = await mkdtemp(join(tmpdir(), 'reel-'));
    return { dir, out: join(dir, 'bundle'), done: () => rm(dir, { recursive: true, force: true }) };
  }

  it('writes a bundle that verifies', async () => {
    const { out, done } = await workspace();
    await writeBundle(assembleBundle(project, receiptAdapter, runtime), out);
    expect((await verifyBundle(out)).ok).toBe(true);
    await done();
  });

  it('leaves no output when interrupted on a first export', async () => {
    const { dir, out, done } = await workspace();
    const files = assembleBundle(project, receiptAdapter, runtime);
    await expect(
      writeBundle(files, out, {
        afterFile: () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(existsSync(out)).toBe(false);
    expect((await readTree(dir)).size).toBe(0);
    await done();
  });

  it('keeps the previous export intact when a new one is interrupted', async () => {
    const { out, done } = await workspace();
    await writeBundle(assembleBundle(project, receiptAdapter, runtime), out);
    const before = await readTree(out);

    let written = 0;
    const changed = { ...project, title: 'A second title' };
    await expect(
      writeBundle(assembleBundle(changed, receiptAdapter, runtime), out, {
        afterFile: () => {
          if (++written === 3) throw new Error('killed');
        },
      }),
    ).rejects.toThrow('killed');

    const after = await readTree(out);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [path, bytes] of before) expect(Buffer.compare(bytes, after.get(path)!), path).toBe(0);
    expect((await verifyBundle(out)).ok).toBe(true);
    await done();
  });

  it('replaces an older export completely', async () => {
    const { out, done } = await workspace();
    await writeBundle(new Map([['old.txt', encode('old')]]), out);
    await writeBundle(assembleBundle(project, receiptAdapter, runtime), out);
    expect(existsSync(join(out, 'old.txt'))).toBe(false);
    await done();
  });

  it('refuses a path that would leave the bundle', async () => {
    const { out, done } = await workspace();
    await expect(writeBundle(new Map([['../escape.txt', encode('x')]]), out)).rejects.toThrow(/Unsafe/);
    await done();
  });
});

describe('verifyBundle', () => {
  it('reports changed, missing and added files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reel-'));
    const out = join(dir, 'bundle');
    await writeBundle(assembleBundle(project, receiptAdapter, runtime), out);
    await writeFile(join(out, 'index.html'), 'tampered');
    await rm(join(out, 'transcript.html'));
    await writeFile(join(out, 'extra.js'), 'alert(1)');
    const result = await verifyBundle(out);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        'Changed file: index.html',
        'Missing file: transcript.html',
        'Unlisted file: extra.js',
      ]),
    );
    await rm(dir, { recursive: true, force: true });
  });
});
