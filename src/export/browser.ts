import type { AnyAdapter } from '../core/adapter';
import type { ReelProject } from '../core/project';
import { assembleBundle } from './bundle';
import { createZip } from './zip';

/** Reads the prebuilt viewer from the editor's own site, one file at a time. */
async function fetchRuntime(
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, Uint8Array>> {
  const base = new URL('./viewer-runtime/', location.href);
  const response = await fetch(new URL('manifest.json', base), { signal });
  if (!response.ok) throw new Error('The viewer runtime is missing. Run: pnpm build:viewer');
  const { files } = (await response.json()) as { files: string[] };

  const runtime = new Map<string, Uint8Array>();
  for (const [i, path] of files.entries()) {
    const file = await fetch(new URL(path, base), { signal });
    if (!file.ok) throw new Error(`The viewer runtime file ${path} could not be read.`);
    runtime.set(path, new Uint8Array(await file.arrayBuffer()));
    onProgress(i + 1, files.length);
  }
  return runtime;
}

/**
 * Builds the bundle in memory and returns a complete archive. Nothing reaches the user
 * until every file has been read, so a cancelled or failed export leaves no partial file.
 */
export async function exportZip(
  project: ReelProject,
  adapter: AnyAdapter,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const runtime = await fetchRuntime(signal, onProgress);
  signal.throwIfAborted();
  return createZip(assembleBundle(project, adapter, runtime));
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
