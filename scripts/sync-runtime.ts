/**
 * Makes the built viewer available to the editor, which assembles exports in the browser.
 * It copies dist/viewer to public/viewer-runtime with a file list, and adds the license
 * notices that every exported bundle must carry.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTree } from '../src/export/write';

const notices = [
  ['Geist Sans and Geist Serif fonts', 'node_modules/geist/LICENSE.txt'],
  ['React', 'node_modules/react/LICENSE'],
  ['React DOM', 'node_modules/react-dom/LICENSE'],
] as const;

const parts = ['Third party software included in this bundle.\n'];
for (const [name, path] of notices) {
  parts.push(`\n----- ${name} -----\n\n${await readFile(path, 'utf8')}`);
}
await writeFile('dist/viewer/THIRD_PARTY_LICENSES.txt', parts.join(''));

const target = 'public/viewer-runtime';
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp('dist/viewer', target, { recursive: true });
const files = [...(await readTree('dist/viewer')).keys()].sort();
await writeFile(join(target, 'manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`Viewer runtime synced: ${files.length} files.`);
