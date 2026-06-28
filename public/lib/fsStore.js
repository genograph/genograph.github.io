/* ============================================================
 * Genograph — File System Access storage backend
 *
 * When the user picks a folder (Chromium browsers), each tree becomes a real
 * `<id>.json` file in that directory — exactly like the Node app's data folder,
 * including a `.backups/` copy before every overwrite and a `.trash/` copy on
 * delete. The directory handle is obtained by storage.js (which also persists it
 * in IndexedDB and re-grants permission on return); this module only does I/O
 * through whatever handle it is given, so it has no DOM/global dependencies.
 * ============================================================ */
'use strict';

import { isValidTree, isValidId, uniqueId, treeMeta, withName, emptyTree } from './treeStore.js';

const BACKUP_DIR = '.backups';
const TRASH_DIR = '.trash';
const MAX_BACKUPS = 50;

function timestamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

async function readJson(dir, name) {
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

async function writeJson(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(data, null, 2) + '\n');
  await writable.close();
}

async function fileExists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/** Create a store backed by a File System Access directory handle. */
export function createFsStore(dirHandle) {
  const dir = dirHandle;
  const fileFor = id => {
    if (!isValidId(id)) throw Object.assign(new Error('Invalid tree id'), { code: 'EBADID' });
    return id + '.json';
  };

  async function listIds() {
    const ids = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || name.startsWith('.') || !name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (isValidId(id)) ids.push(id);
    }
    return ids;
  }

  // Copy the current file (if any) into .backups/ and trim old copies.
  async function backup(id) {
    const name = id + '.json';
    if (!(await fileExists(dir, name))) return;
    try {
      const data = await readJson(dir, name);
      const bdir = await dir.getDirectoryHandle(BACKUP_DIR, { create: true });
      await writeJson(bdir, `${id}-${timestamp()}.json`, data);
      const backups = [];
      for await (const [bn, h] of bdir.entries()) {
        if (h.kind === 'file' && bn.startsWith(id + '-') && bn.endsWith('.json')) backups.push(bn);
      }
      backups.sort();
      while (backups.length > MAX_BACKUPS) await bdir.removeEntry(backups.shift());
    } catch { /* backups are best-effort; never block a save */ }
  }

  const store = {
    kind: 'fs',
    folderName: dir.name,

    async list() {
      const out = [];
      for (const id of await listIds()) {
        try { out.push(treeMeta(await readJson(dir, id + '.json'), id)); }
        catch { out.push({ id, name: id, people: 0, updated_at: null, error: true }); }
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },

    async read(id) {
      try { return await readJson(dir, fileFor(id)); }
      catch (e) {
        if (e.code === 'EBADID') throw e;
        throw Object.assign(new Error('Tree not found'), { code: 'ENOENT' });
      }
    },

    async write(id, data) {
      const name = fileFor(id);
      if (!isValidTree(data)) {
        throw Object.assign(new Error('A tree must be an object with a "people" array.'), { code: 'EBADTREE' });
      }
      await backup(id);
      await writeJson(dir, name, data);
      return { id, people: data.people.length };
    },

    async create(name) {
      const display = String(name ?? '').trim() || 'Untitled tree';
      const id = uniqueId(new Set(await listIds()), display);
      await writeJson(dir, id + '.json', emptyTree(display));
      return { id, name: display };
    },

    async rename(id, name) {
      const display = String(name ?? '').trim();
      if (!display) throw Object.assign(new Error('Name cannot be empty.'), { code: 'EBADNAME' });
      await store.write(id, withName(await store.read(id), display));
      return { id, name: display };
    },

    async duplicate(id) {
      const raw = await store.read(id);
      const display = `${(raw.summary && raw.summary.name) || id} (copy)`;
      const newId = uniqueId(new Set(await listIds()), display);
      await store.write(newId, withName(raw, display));
      return { id: newId, name: display };
    },

    async importTree(name, data) {
      if (!isValidTree(data)) throw Object.assign(new Error('Not a valid tree file.'), { code: 'EBADTREE' });
      const display = String(name ?? '').trim() || (data.summary && data.summary.name) || 'Imported tree';
      const id = uniqueId(new Set(await listIds()), display);
      await store.write(id, withName(data, display));
      return { id, name: display };
    },

    // Move the tree into .trash/ (recoverable), then remove it from the folder.
    async delete(id) {
      const name = fileFor(id);
      try {
        const data = await readJson(dir, name);
        const tdir = await dir.getDirectoryHandle(TRASH_DIR, { create: true });
        await writeJson(tdir, `${id}-${timestamp()}.json`, data);
      } catch { /* if unreadable, still remove the original below */ }
      await dir.removeEntry(name);
      return { id };
    }
  };
  return store;
}
