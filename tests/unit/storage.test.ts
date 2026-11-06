import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ReelProject, parseProject } from '../../src/core/project';
import { DraftStore, storageMessage } from '../../src/storage/drafts';

let base: ReelProject;
let store: DraftStore;

beforeAll(async () => {
  const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8')));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  base = parsed.project;
});

beforeEach(async () => {
  store = await DraftStore.open(new IDBFactory());
});

/** Damages a stored field directly, the way a bad disk or a bug would. */
async function corrupt(id: string, field: 'current' | 'previous') {
  const db = (store as unknown as { db: IDBDatabase }).db;
  const transaction = db.transaction('drafts', 'readwrite');
  const objects = transaction.objectStore('drafts');
  await new Promise<void>((resolve) => {
    const request = objects.get(id);
    request.onsuccess = () => {
      objects.put({ ...request.result, [field]: '{"format":"reel-pro' });
      transaction.oncomplete = () => resolve();
    };
  });
}

describe('DraftStore', () => {
  it('saves and reopens a project exactly', async () => {
    await store.save(base);
    expect((await store.load(base.id))?.project).toEqual(base);
  });

  it('keeps the previous save and can restore it', async () => {
    await store.save({ ...base, title: 'First' });
    await store.save({ ...base, title: 'Second' });
    expect(await store.restorePrevious(base.id)).toBe(true);
    expect((await store.load(base.id))?.project.title).toBe('First');
  });

  it('does not rotate the previous save when nothing changed', async () => {
    await store.save({ ...base, title: 'First' });
    await store.save({ ...base, title: 'Second' });
    await store.save({ ...base, title: 'Second' });
    await store.restorePrevious(base.id);
    expect((await store.load(base.id))?.project.title).toBe('First');
  });

  it('does not rotate when a reopened draft has the same data in another key order', async () => {
    await store.save({ ...base, title: 'First' });
    await store.save({ ...base, title: 'Second' });
    const reordered = Object.fromEntries(Object.entries({ ...base, title: 'Second' }).reverse());
    await store.save(reordered as unknown as ReelProject);
    await store.restorePrevious(base.id);
    expect((await store.load(base.id))?.project.title).toBe('First');
  });

  it('recovers the previous save when the latest is damaged', async () => {
    await store.save({ ...base, title: 'Good' });
    await store.save({ ...base, title: 'Newest' });
    await corrupt(base.id, 'current');
    const loaded = await store.load(base.id);
    expect(loaded?.recovered).toBe(true);
    expect(loaded?.project.title).toBe('Good');
  });

  it('reports a draft with no readable save', async () => {
    await store.save(base);
    await corrupt(base.id, 'current');
    expect(await store.load(base.id)).toBeNull();
  });

  it('refuses to restore a damaged previous save', async () => {
    await store.save({ ...base, title: 'A' });
    await store.save({ ...base, title: 'B' });
    await corrupt(base.id, 'previous');
    expect(await store.restorePrevious(base.id)).toBe(false);
    expect((await store.load(base.id))?.project.title).toBe('B');
  });

  it('lists newest first with sizes, and cleans up', async () => {
    await store.save({ ...base, id: 'older' }, 100);
    await store.save({ ...base, id: 'newer' }, 200);
    const list = await store.list();
    expect(list.map((d) => d.id)).toEqual(['newer', 'older']);
    expect(list[0]?.commandCount).toBe(base.commands.length);
    expect(list[0]?.bytes).toBeGreaterThan(1000);

    await store.remove('older');
    expect((await store.list()).map((d) => d.id)).toEqual(['newer']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('turns a quota failure into a plain message', () => {
    expect(storageMessage(new DOMException('full', 'QuotaExceededError'))).toMatch(/out of storage/);
    expect(storageMessage(new Error('other'))).toMatch(/could not save/);
  });
});
