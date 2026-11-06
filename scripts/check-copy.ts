/** Fails if em dashes, en dashes or emoji reach product copy or documentation. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['src', 'site', 'docs', 'scripts', 'bench', 'tests', 'projects'];
const top = ['README.md', 'NOTICE.md', 'viewer.html', 'index.html'];
// Built from code points, so this file does not contain the characters it bans.
const dashes = String.fromCodePoint(0x2013, 0x2014);
const banned = new RegExp(`[${dashes}]|\\p{Extended_Pictographic}`, 'u');
const skip = /\.(woff2|png|mp4|webm|lock)$/;

const paths: string[] = [...top];
for (const root of roots) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && !skip.test(entry.name)) paths.push(join(entry.parentPath, entry.name));
  }
}

let failures = 0;
for (const path of paths) {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    // Test data may hold a character on purpose to prove it survives hashing.
    if (banned.test(line) && !path.endsWith('canonical.test.ts')) {
      console.error(`${path}:${i + 1}: ${line.trim().slice(0, 100)}`);
      failures++;
    }
  });
}
if (failures > 0) {
  console.error(`${failures} lines use a banned character.`);
  process.exit(1);
}
