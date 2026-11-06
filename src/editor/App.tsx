import { useCallback, useEffect, useState } from 'react';
import type { AnyAdapter } from '../core/adapter';
import {
  FORMAT,
  FORMAT_VERSION,
  type ReelProject,
  parseProject,
  validateCommands,
} from '../core/project';
import { resolveScene } from '../core/registry';
import { SCENES } from '../scenes/registry';
import { DraftStore, type DraftSummary, storageMessage } from '../storage/drafts';
import { Workspace } from './Workspace';

/** Bounds the memory an imported file can take before parsing starts. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

const CHECKPOINT_EVERY = 256;

interface Open {
  adapter: AnyAdapter;
  project: ReelProject;
  /** Shown once in the workspace, such as after a recovery. */
  notice: string | null;
}

function newProject(adapter: AnyAdapter): ReelProject {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id: `${adapter.id}-${suffix}`,
    title: `${adapter.title} demo`,
    disclosure: 'Synthetic data. No real people or accounts.',
    scene: { id: adapter.id, version: adapter.version },
    seed: 1,
    checkpointEvery: CHECKPOINT_EVERY,
    trim: null,
    posterT: 0,
    commands: [],
    chapters: [],
    captions: [],
    camera: [],
  };
}

export function App() {
  const [open, setOpen] = useState<Open | null>(null);
  const [drafts, setDrafts] = useState<DraftStore | null>(null);
  const [list, setList] = useState<DraftSummary[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | 'all' | null>(null);
  const [storage, setStorage] = useState<string | null>(null);

  const refresh = useCallback(async (store: DraftStore) => {
    try {
      setList(await store.list());
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined) {
        setStorage(`This browser holds ${(estimate.usage / 1024 / 1024).toFixed(1)} MB for this site.`);
      }
    } catch (error) {
      setProblems([storageMessage(error)]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    DraftStore.open()
      .then((store) => {
        if (cancelled) {
          store.close();
          return;
        }
        setDrafts(store);
        void refresh(store);
      })
      .catch(() => {
        setProblems(['Local drafts are not available in this browser. You can still export files.']);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const openProject = async (project: ReelProject, openNotice: string | null = null) => {
    const resolved = await resolveScene(project, SCENES);
    if (!resolved.ok) {
      setProblems([resolved.message]);
      return;
    }
    // Only commands can make a project impossible to play. A track problem must not lock
    // an author out of their work, and the export dialog lists those.
    const issues = validateCommands(resolved.adapter, resolved.project);
    if (issues.length > 0) {
      setProblems(['This project cannot play.', ...issues.slice(0, 6).map((i) => i.message)]);
      return;
    }
    setProblems([]);
    setOpen({ adapter: resolved.adapter, project: resolved.project, notice: openNotice });
  };

  const createProject = async (id: string) => {
    const entry = SCENES.find((scene) => scene.id === id)!;
    const adapter = await entry.load();
    setProblems([]);
    setOpen({ adapter, project: newProject(adapter), notice: null });
  };

  const importFile = async (file: File) => {
    setNotice(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setProblems([`This file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 64 MB.`]);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setProblems(['This file is not valid JSON, so it is not a Reel project.']);
      return;
    }
    const parsed = parseProject(raw);
    if (!parsed.ok) {
      setProblems(parsed.errors.slice(0, 6));
      return;
    }
    // Saving under an existing id would replace that draft and push out its last save.
    if (list.some((draft) => draft.id === parsed.project.id)) {
      const id = `${parsed.project.id.slice(0, 50)}-${crypto.randomUUID().slice(0, 8)}`;
      await openProject(
        { ...parsed.project, id },
        'A draft of this project already exists. This file opened as a separate copy.',
      );
      return;
    }
    await openProject(parsed.project);
  };

  const openDraft = async (id: string) => {
    if (drafts === null) return;
    setNotice(null);
    try {
      const loaded = await drafts.load(id);
      if (loaded === null) {
        setProblems(['This draft is damaged and has no earlier save to recover.']);
        return;
      }
      await openProject(
        loaded.project,
        loaded.recovered ? 'The latest save was damaged. Reel opened the save before it.' : null,
      );
    } catch (error) {
      setProblems([storageMessage(error)]);
    }
  };

  const restorePrevious = async (id: string) => {
    if (drafts === null) return;
    const restored = await drafts.restorePrevious(id);
    setNotice(restored ? 'Restored the previous save.' : 'There is no earlier save to restore.');
    await refresh(drafts);
  };

  const remove = async (id: string | 'all') => {
    if (drafts === null) return;
    setConfirming(null);
    try {
      if (id === 'all') await drafts.clear();
      else await drafts.remove(id);
      setNotice(id === 'all' ? 'All drafts deleted.' : 'Draft deleted.');
      await refresh(drafts);
    } catch (error) {
      setProblems([storageMessage(error)]);
    }
  };

  if (open !== null) {
    return (
      <Workspace
        key={open.project.id}
        adapter={open.adapter}
        initial={open.project}
        notice={open.notice}
        drafts={drafts}
        onClose={() => {
          setOpen(null);
          if (drafts !== null) void refresh(drafts);
        }}
      />
    );
  }

  const totalBytes = list.reduce((sum, draft) => sum + draft.bytes, 0);

  return (
    <main className="st">
      <header>
        <h1>Reel</h1>
        <p>
          Record a workflow from a supported React scene, shape it into a story, and export a page
          where viewers can stop the story and try the product. Everything stays on this computer.
        </p>
      </header>

      {problems.length > 0 && (
        <div className="st-problems" role="alert">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      {notice !== null && (
        <p className="st-notice" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="st-new">
        <h2 id="st-new">Start a recording</h2>
        <ul className="st-scenes">
          {SCENES.map((scene) => (
            <li key={scene.id}>
              <button type="button" onClick={() => void createProject(scene.id)}>
                {scene.title}
                <small>
                  {scene.id} v{scene.version}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <label className="st-import">
          Open a project file
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) void importFile(file);
            }}
          />
        </label>
      </section>

      <section aria-labelledby="st-drafts">
        <h2 id="st-drafts">Drafts</h2>
        {list.length === 0 ? (
          <p className="st-empty">Drafts save themselves here as you work.</p>
        ) : (
          <>
            <ul className="st-drafts">
              {list.map((draft) => (
                <li key={draft.id}>
                  <button type="button" className="st-open" onClick={() => void openDraft(draft.id)}>
                    {draft.title}
                    <small>
                      {draft.commandCount} commands, {(draft.bytes / 1024).toFixed(1)} KB
                    </small>
                  </button>
                  {draft.hasPrevious && (
                    <button type="button" className="ed-text" onClick={() => void restorePrevious(draft.id)}>
                      Restore previous save
                    </button>
                  )}
                  {confirming === draft.id ? (
                    <button type="button" className="ed-text ed-remove" onClick={() => void remove(draft.id)}>
                      Yes, delete "{draft.title}"
                    </button>
                  ) : (
                    <button type="button" className="ed-text" onClick={() => setConfirming(draft.id)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="st-foot">
              {list.length} {list.length === 1 ? 'draft' : 'drafts'}, {(totalBytes / 1024).toFixed(1)} KB.{' '}
              {storage}{' '}
              {confirming === 'all' ? (
                <button type="button" className="ed-text ed-remove" onClick={() => void remove('all')}>
                  Yes, delete all drafts
                </button>
              ) : (
                <button type="button" className="ed-text" onClick={() => setConfirming('all')}>
                  Delete all drafts
                </button>
              )}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
