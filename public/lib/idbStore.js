/* ============================================================
 * Genograph — IndexedDB storage backend
 *
 * The universal browser fallback: each tree is one record in IndexedDB, keyed
 * by its id. Works in every modern browser and persists across reloads. On the
 * first run it seeds the bundled example tree, and it asks the browser to make
 * storage persistent so the data resists eviction. Export/Import JSON (in the
 * UI) is the portability + backup path for this backend.
 *
 * This module also owns the single IndexedDB database used by the app, including
 * a small `meta` store that storage.js uses to remember a chosen folder handle.
 * ============================================================ */
'use strict';

import { isValidTree, isValidId, uniqueId, treeMeta, emptyTree, withName } from './treeStore.js';

const DB_NAME = 'genograph';
const DB_VERSION = 1;
const TREES = 'trees';
const META = 'meta';

let dbPromise = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db() { return (dbPromise ||= openDb()); }

const reqP = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const txDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

async function get1(storeName, key) {
  const d = await db();
  return reqP(d.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function put1(storeName, key, value) {
  const d = await db();
  const tx = d.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value, key);
  await txDone(tx);
}

async function del1(storeName, key) {
  const d = await db();
  const tx = d.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await txDone(tx);
}

async function treeKeys() {
  const d = await db();
  return reqP(d.transaction(TREES, 'readonly').objectStore(TREES).getAllKeys());
}

async function treeEntries() {
  const d = await db();
  const os = d.transaction(TREES, 'readonly').objectStore(TREES);
  const [keys, vals] = await Promise.all([reqP(os.getAllKeys()), reqP(os.getAll())]);
  return keys.map((k, i) => [k, vals[i]]);
}

/* ---- meta store (used by storage.js for the folder handle) ---- */
export const getMeta = key => get1(META, key);
export const setMeta = (key, value) => put1(META, key, value);
export const delMeta = key => del1(META, key);

/** Ask the browser to keep this origin's storage persistent (best-effort). */
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

/** Create the IndexedDB-backed store. */
export function createIdbStore() {
  const store = {
    kind: 'idb',

    async list() {
      const out = (await treeEntries()).map(([id, raw]) => treeMeta(raw, id));
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },

    async read(id) {
      const raw = await get1(TREES, id);
      if (raw === undefined) throw Object.assign(new Error('Tree not found'), { code: 'ENOENT' });
      return raw;
    },

    async write(id, data) {
      if (!isValidId(id)) throw Object.assign(new Error('Invalid tree id'), { code: 'EBADID' });
      if (!isValidTree(data)) {
        throw Object.assign(new Error('A tree must be an object with a "people" array.'), { code: 'EBADTREE' });
      }
      await put1(TREES, id, data);
      return { id, people: data.people.length };
    },

    async create(name) {
      const display = String(name ?? '').trim() || 'Untitled tree';
      const id = uniqueId(new Set(await treeKeys()), display);
      await put1(TREES, id, emptyTree(display));
      return { id, name: display };
    },

    async rename(id, name) {
      const display = String(name ?? '').trim();
      if (!display) throw Object.assign(new Error('Name cannot be empty.'), { code: 'EBADNAME' });
      await put1(TREES, id, withName(await store.read(id), display));
      return { id, name: display };
    },

    async duplicate(id) {
      const raw = await store.read(id);
      const display = `${(raw.summary && raw.summary.name) || id} (copy)`;
      const newId = uniqueId(new Set(await treeKeys()), display);
      await put1(TREES, newId, withName(raw, display));
      return { id: newId, name: display };
    },

    async importTree(name, data) {
      if (!isValidTree(data)) throw Object.assign(new Error('Not a valid tree file.'), { code: 'EBADTREE' });
      const display = String(name ?? '').trim() || (data.summary && data.summary.name) || 'Imported tree';
      const id = uniqueId(new Set(await treeKeys()), display);
      await put1(TREES, id, withName(data, display));
      return { id, name: display };
    },

    async delete(id) {
      await del1(TREES, id);
      return { id };
    },

    /** Seed the bundled example tree the first time this browser is used. */
    async seedIfEmpty(seedUrl = 'examples/lusignan.json', seedId = 'lusignan') {
      if ((await treeKeys()).length) return { seeded: false };
      try {
        const res = await fetch(seedUrl);
        if (!res.ok) return { seeded: false };
        const data = await res.json();
        if (!isValidTree(data)) return { seeded: false };
        const id = isValidId(seedId) ? seedId : uniqueId(new Set(), seedId);
        await put1(TREES, id, data);
        return { seeded: true, id };
      } catch { return { seeded: false }; }
    },

    persist
  };
  return store;
}
