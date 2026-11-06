import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { sha256 } from '../core/sha256';
import { type BundleManifest, MANIFEST_PATH } from './bundle';

export async function readTree(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files.set(relative(root, full).split(sep).join('/'), await readFile(full));
  }
  return files;
}

export interface WriteOptions {
  /** Test hook. Runs after each file, and throwing here simulates an interrupted export. */
  afterFile?: (path: string) => void;
}

/**
 * Writes a bundle so that `out` is always complete or untouched.
 *
 * Files go to a sibling temporary folder, and a rename puts the folder in place. A crash
 * at any point leaves the previous export unchanged. A rename is atomic only within one
 * filesystem, which is why the temporary folder sits next to `out`.
 */
export async function writeBundle(
  files: ReadonlyMap<string, Uint8Array>,
  out: string,
  options: WriteOptions = {},
): Promise<void> {
  const target = resolve(out);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = `${target}.partial-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });

  try {
    for (const [path, bytes] of files) {
      const full = join(temporary, path);
      if (!full.startsWith(temporary + sep)) throw new Error(`Unsafe path in bundle: ${path}`);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
      options.afterFile?.(path);
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  let replaced = false;
  try {
    await rename(target, previous);
    replaced = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(temporary, target);
  if (replaced) await rm(previous, { recursive: true, force: true });
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  manifest: BundleManifest | null;
}

/** Checks a bundle on disk against its manifest: nothing missing, changed or added. */
export async function verifyBundle(root: string): Promise<VerifyResult> {
  const files = await readTree(root);
  const raw = files.get(MANIFEST_PATH);
  if (raw === undefined) return { ok: false, problems: ['The manifest is missing.'], manifest: null };
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as BundleManifest;
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const file of manifest.files) {
    listed.add(file.path);
    const bytes = files.get(file.path);
    if (bytes === undefined) problems.push(`Missing file: ${file.path}`);
    else if (sha256(bytes) !== file.sha256) problems.push(`Changed file: ${file.path}`);
  }
  for (const path of files.keys()) {
    if (path !== MANIFEST_PATH && !listed.has(path)) problems.push(`Unlisted file: ${path}`);
  }
  return { ok: problems.length === 0, problems, manifest };
}
