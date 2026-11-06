import { parseProject } from '../core/project';
import { type SceneEntry, resolveScene } from '../core/registry';
import { hashJson } from '../core/sha256';
import { Timeline } from '../core/timeline';
import type { BundleManifest } from './bundle';

/**
 * Replays a bundle's project and compares the final state with the manifest. A matching
 * file hash shows the bytes are as exported. This shows they still produce that story with
 * the scenes in this build. Returns a problem, or null.
 */
export async function checkReplay(
  manifest: BundleManifest,
  projectText: string,
  scenes: readonly SceneEntry[],
): Promise<string | null> {
  const parsed = parseProject(JSON.parse(projectText));
  if (!parsed.ok) return `The project is not valid: ${parsed.errors[0]}`;
  const resolved = await resolveScene(parsed.project, scenes);
  if (!resolved.ok) return resolved.message;
  const { adapter, project } = resolved;
  const timeline = new Timeline(adapter, project.commands, {
    seed: project.seed,
    checkpointEvery: project.checkpointEvery,
  });
  const hash = hashJson(adapter.serialize(timeline.stateAfter(project.commands.length)));
  return hash === manifest.finalStateHash
    ? null
    : 'The replayed final state does not match the manifest.';
}
