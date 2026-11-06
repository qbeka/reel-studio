import type { AnyAdapter } from './adapter';
import { type ReelProject, migrateCommands } from './project';

/** One installed scene. Scene code loads only when a project asks for it. */
export interface SceneEntry {
  id: string;
  version: number;
  title: string;
  load: () => Promise<AnyAdapter>;
}

export type Resolution =
  | { ok: true; adapter: AnyAdapter; project: ReelProject }
  | { ok: false; code: 'unknown-scene' | 'newer-version' | 'no-migration'; message: string };

/**
 * Finds the code for a project. See "Scene resolution" in docs/FORMAT.md.
 * Only entries compiled into this build can resolve. A project file cannot add one.
 */
export async function resolveScene(
  project: ReelProject,
  installed: readonly SceneEntry[],
): Promise<Resolution> {
  const { id, version } = project.scene;
  const entry = installed.find((e) => e.id === id);
  if (entry === undefined) {
    const names = installed.map((e) => `${e.id} v${e.version}`).join(', ');
    return {
      ok: false,
      code: 'unknown-scene',
      message: `This project needs the scene ${id} v${version}, which is not installed. Installed scenes: ${names}.`,
    };
  }
  if (version > entry.version) {
    return {
      ok: false,
      code: 'newer-version',
      message: `This project was recorded with ${id} v${version}. This build has v${entry.version}. Update Reel to open it.`,
    };
  }
  const adapter = await entry.load();
  if (version === entry.version) return { ok: true, adapter, project };
  if (adapter.migrateCommand === undefined) {
    return {
      ok: false,
      code: 'no-migration',
      message: `This project was recorded with ${id} v${version}. This build has v${entry.version} and no way to upgrade it.`,
    };
  }
  return {
    ok: true,
    adapter,
    project: {
      ...project,
      scene: { id, version: entry.version },
      commands: migrateCommands(adapter, project.commands, version),
    },
  };
}
