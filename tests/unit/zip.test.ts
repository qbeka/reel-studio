import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../../src/export/zip';

const encode = (text: string) => new TextEncoder().encode(text);

describe('createZip', () => {
  it('matches the standard CRC-32 check value', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  });

  it('produces an archive that the system unzip accepts and extracts exactly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reel-zip-'));
    const big = new Uint8Array(70000).map((_, i) => (i * 7) & 0xff);
    const zip = createZip(
      new Map([
        ['index.html', encode('<h1>hello</h1>')],
        ['assets/a.bin', big],
        ['empty.txt', new Uint8Array(0)],
      ]),
    );
    const path = join(dir, 'out.zip');
    await writeFile(path, zip);
    execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
    execFileSync('unzip', ['-q', path, '-d', join(dir, 'x')], { stdio: 'pipe' });
    expect(await readFile(join(dir, 'x/index.html'), 'utf8')).toBe('<h1>hello</h1>');
    expect(Buffer.compare(await readFile(join(dir, 'x/assets/a.bin')), big)).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('is deterministic', () => {
    const files = new Map([['a.txt', encode('a')]]);
    expect(Buffer.compare(createZip(files), createZip(files))).toBe(0);
  });
});
