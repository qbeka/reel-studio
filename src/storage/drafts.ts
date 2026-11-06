import { canonicalJson } from '../core/canonical';
import type { ReelProject } from '../core/project';
import { parseProject } from '../core/project';

const DB_NAME = 'reel-studio';
const DB_VERSION = 1;
const STORE = 'drafts';

interface DraftRecord {
  id: string;
  title: string;
  sceneId: string;
  updatedAt: number;
  /** JSON text, so a damaged value is detected by parsing rather than trusted. */
  current: string;
  /** The save before `current`. This is what recovery falls back to. */
  previous: string | null;
}

export interface DraftSummary {
  id: string;
  title: string;
  sceneId: string;
  updatedAt: number;
  commandCount: number;
  bytes: number;
  hasPrevious: boolean;
}

export interface LoadedDraft {
  project: ReelProject;
  /** True when `current` was damaged and the previous save was used. */
  recovered: boolean;
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when the data is durable, and rejects if the browser aborted the write. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('The save was aborted.'));
  });
}

function parseDraft(text: string | null): ReelProject | null {
  if (text === null) return null;
  try {
    const result = parseProject(JSON.parse(text));
    return result.ok ? result.project : null;
  } catch {
    return null;
  }
}

function sameProject(stored: string, project: ReelProject): boolean {
  const parsed = parseDraft(stored);
  return parsed !== null && canonicalJson(parsed) === canonicalJson(project);
}

/** A plain sentence for the most likely failures. */
export function storageMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'QuotaExceededError') {
    return 'This browser is out of storage space. Delete old drafts or download the project file.';
  }
  return 'This browser could not save the draft. Download the project file to keep your work.';
}

export class DraftStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB): Promise<DraftStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(new DraftStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Reel tabs and try again.'));
    });
  }

  /**
   * Saves a project and keeps the last save. Reading the old record and writing the new
   * one share a transaction, so a failure leaves both versions as they were.
   */
  async save(project: ReelProject, now: number = Date.now()): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    const done = committed(transaction);
    const store = transaction.objectStore(STORE);
    let failure: unknown;
    const request = store.get(project.id);
    request.onsuccess = () => {
      const old = request.result as DraftRecord | undefined;
      const current = JSON.stringify(project);
      // Canonical, because a reopened draft has the same data with its keys in file order.
      if (old !== undefined && sameProject(old.current, project)) return;
      const record: DraftRecord = {
        id: project.id,
        title: project.title,
        sceneId: project.scene.id,
        updatedAt: now,
        current,
        previous: old?.current ?? null,
      };
      try {
        store.put(record);
      } catch (error) {
        // `put` can throw here, inside an event handler where nothing would catch it.
        failure = error;
        transaction.abort();
      }
    };
    await done.catch((error) => {
      throw failure ?? error;
    });
  }

  async list(): Promise<DraftSummary[]> {
    const store = this.db.transaction(STORE).objectStore(STORE);
    const records = (await asPromise(store.getAll())) as DraftRecord[];
    return records
      .map((record) => ({
        id: record.id,
        title: record.title,
        sceneId: record.sceneId,
        updatedAt: record.updatedAt,
        commandCount: parseDraft(record.current)?.commands.length ?? 0,
        bytes: record.current.length + (record.previous?.length ?? 0),
        hasPrevious: record.previous !== null,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Loads a draft. Falls back to the previous save if the latest one is damaged. */
  async load(id: string): Promise<LoadedDraft | null> {
    const store = this.db.transaction(STORE).objectStore(STORE);
    const record = (await asPromise(store.get(id))) as DraftRecord | undefined;
    if (record === undefined) return null;
    const current = parseDraft(record.current);
    if (current !== null) return { project: current, recovered: false };
    const previous = parseDraft(record.previous);
    return previous === null ? null : { project: previous, recovered: true };
  }

  /** Swaps back to the save before the latest one, if there is one. */
  async restorePrevious(id: string): Promise<boolean> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    const done = committed(transaction);
    const store = transaction.objectStore(STORE);
    let restored = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result as DraftRecord | undefined;
      if (record?.previous == null || parseDraft(record.previous) === null) return;
      restored = true;
      store.put({ ...record, current: record.previous, previous: record.current });
    };
    await done;
    return restored;
  }

  async remove(id: string): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    const done = committed(transaction);
    transaction.objectStore(STORE).delete(id);
    await done;
  }

  async clear(): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    const done = committed(transaction);
    transaction.objectStore(STORE).clear();
    await done;
  }

  close(): void {
    this.db.close();
  }
}
