/* ============================================================
 * Genograph — tree file storage
 *
 * Each family tree is one JSON file in the data directory. Saving first copies
 * the previous version into `.backups/` (newest kept). All ids are validated
 * and every resolved path is asserted to stay inside the data directory, so a
 * crafted id can never read or write outside it.
 * ============================================================ */
'use strict';

import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { slugify, isValidId, suffixedId, validateTree } from '../public/lib/treeStore.js';

const MAX_BACKUPS = 50;          // per tree
const BACKUP_DIR = '.backups';
const TRASH_DIR = '.trash';
const ALLOCATE_LOCK = Symbol('tree-id-allocation');

// `slugify` / `isValidId` (and the id length cap) live in the shared helper
// module so every storage backend \u2014 Node, IndexedDB and File System Access \u2014
// agrees on id rules. Re-exported here so existing importers/tests are unchanged.
export { slugify, isValidId };

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function timestamp() {
  return new Date().toISOString().replace(/[:T.]/g, '-').replace('Z', '');
}

const recoveryName = id => `${id}-${timestamp()}-${randomUUID()}.json`;

function badTree(err) {
  return Object.assign(new Error(err.message), { code: 'EBADTREE' });
}

export class TreeStore {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir);
    this.backupDir = path.join(this.dir, BACKUP_DIR);
    this.trashDir = path.join(this.dir, TRASH_DIR);
    this._writeQueues = new Map();
  }

  async init({ secureExisting = false } = {}) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (secureExisting && process.platform !== 'win32') await this._secureExisting();
    return this;
  }

  /** Resolve a tree id to its file path, refusing anything outside the data dir. */
  pathFor(id) {
    if (!isValidId(id)) throw Object.assign(new Error('Invalid tree id'), { code: 'EBADID' });
    const file = path.join(this.dir, id + '.json');
    const rel = path.relative(this.dir, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw Object.assign(new Error('Invalid tree id'), { code: 'EBADID' });
    }
    return file;
  }

  /** Pick a fresh id derived from a name, avoiding collisions on disk. */
  async uniqueId(name) {
    let base = slugify(name) || 'tree';
    let id = base, n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (await this._exists(this.pathFor(id))) id = suffixedId(base, n++);
    return id;
  }

  async _exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  /** List trees as lightweight metadata (id, name, people count, updated_at). */
  async list() {
    let names;
    try { names = await fs.readdir(this.dir); } catch { return []; }
    const out = [];
    for (const f of names) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      const id = f.slice(0, -5);
      if (!isValidId(id)) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8'));
        validateTree(data);
        out.push({
          id,
          name: (data.summary && data.summary.name) || id,
          people: Array.isArray(data.people) ? data.people.length : 0,
          updated_at: (data.summary && data.summary.last_modified) || null
        });
      } catch {
        out.push({ id, name: id, people: 0, updated_at: null, error: true });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Read and parse a tree. */
  async read(id) {
    const buf = await fs.readFile(this.pathFor(id), 'utf8');
    try { return validateTree(JSON.parse(buf)); }
    catch (err) { throw badTree(err instanceof SyntaxError ? new Error('Not a valid tree file: invalid JSON.') : err); }
  }

  /** Validate, back up the previous version, then atomically write a tree. */
  async write(id, data) {
    try { validateTree(data); } catch (err) { throw badTree(err); }
    const file = this.pathFor(id);
    return this._serializeWrite(id, async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      await this._backup(id, file);
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      let renamed = false;
      try {
        await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(tmp, file);   // atomic on the same filesystem
        renamed = true;
      } finally {
        if (!renamed) await fs.unlink(tmp).catch(() => {});
      }
      return { id, people: data.people.length };
    });
  }

  /** Create a new, empty tree with the given display name. */
  async create(name) {
    const display = String(name ?? '').trim() || 'Untitled tree';
    return this._serializeWrite(ALLOCATE_LOCK, async () => {
      const id = await this.uniqueId(display);
      const data = { summary: { name: display, total_people: 0 }, people: [] };
      await this.write(id, data);
      return { id, name: display };
    });
  }

  /** Change a tree's display name (the file id stays stable). */
  async rename(id, name) {
    const display = String(name ?? '').trim();
    if (!display) throw Object.assign(new Error('Name cannot be empty.'), { code: 'EBADNAME' });
    const data = await this.read(id);
    data.summary = data.summary || {};
    data.summary.name = display;
    await this.write(id, data);
    return { id, name: display };
  }

  /** Copy an existing tree to a new id with a "(copy)" name. */
  async duplicate(id) {
    return this._serializeWrite(ALLOCATE_LOCK, async () => {
      const data = await this.read(id);
      const base = (data.summary && data.summary.name) || id;
      const display = `${base} (copy)`;
      const newId = await this.uniqueId(display);
      data.summary = data.summary || {};
      data.summary.name = display;
      await this.write(newId, data);
      return { id: newId, name: display };
    });
  }

  /** Import an external tree object as a new tree. */
  async importTree(name, data) {
    try { validateTree(data); } catch (err) { throw badTree(err); }
    const display = String(name ?? '').trim() || (data.summary && data.summary.name) || 'Imported tree';
    return this._serializeWrite(ALLOCATE_LOCK, async () => {
      const id = await this.uniqueId(display);
      data.summary = data.summary || {};
      data.summary.name = display;
      await this.write(id, data);
      return { id, name: display };
    });
  }

  /** Move a tree to the trash folder (recoverable; not a hard delete). */
  async delete(id) {
    const file = this.pathFor(id);
    return this._serializeWrite(id, async () => {
      await fs.mkdir(this.trashDir, { recursive: true, mode: 0o700 });
      const dest = path.join(this.trashDir, recoveryName(id));
      // link is no-clobber; unlink only after the recoverable copy exists.
      await fs.link(file, dest);
      await fs.unlink(file);
      return { id, trashed: path.basename(dest) };
    });
  }

  /**
   * Move every tree file into another directory and return the moved ids.
   * Used when the user changes their data folder and asks to take their trees
   * along. Names that already exist at the destination get a numeric suffix so
   * nothing is clobbered. Falls back to copy+delete across filesystems (e.g. an
   * external drive), where a plain rename is not allowed.
   */
  async moveTo(destDir) {
    const dest = path.resolve(destDir);
    if (dest === this.dir) return [];
    await fs.mkdir(dest, { recursive: true, mode: 0o700 });
    const moved = [];
    for (const { id } of await this.list()) {
      const from = this.pathFor(id);
      // eslint-disable-next-line no-await-in-loop
      const movedId = await this._moveNoClobber(from, dest, id);
      moved.push(movedId);
    }
    return moved;
  }

  /** Seed the example tree on first run when the data directory has no trees. */
  async seedIfEmpty(seedFile, seedId = 'lusignan') {
    const existing = await this.list();
    if (existing.length) return { seeded: false };
    try {
      const data = JSON.parse(await fs.readFile(seedFile, 'utf8'));
      const id = isValidId(seedId) ? seedId : await this.uniqueId(seedId);
      await this.write(id, data);
      return { seeded: true, id };
    } catch {
      return { seeded: false };
    }
  }

  // ---- internal ----

  /** Tighten an existing app-owned default store without touching custom folders. */
  async _secureExisting() {
    await fs.chmod(this.dir, 0o700);
    const entries = await fs.readdir(this.dir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(this.dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.json')) await fs.chmod(target, 0o600);
      if (entry.isDirectory() && (entry.name === BACKUP_DIR || entry.name === TRASH_DIR)) {
        await fs.chmod(target, 0o700);
        const recoveries = await fs.readdir(target, { withFileTypes: true });
        for (const recovery of recoveries) {
          if (recovery.isFile()) await fs.chmod(path.join(target, recovery.name), 0o600);
        }
      }
    }
  }

  /** Serialize writes to one tree while allowing different trees in parallel. */
  async _serializeWrite(id, operation) {
    const previous = this._writeQueues.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this._writeQueues.set(id, current);
    try { return await current; }
    finally { if (this._writeQueues.get(id) === current) this._writeQueues.delete(id); }
  }

  /** Move without overwriting, using only ids the destination store can list. */
  async _moveNoClobber(from, destDir, baseId) {
    for (let n = 1; ; n++) {
      const id = n === 1 ? baseId : suffixedId(baseId, n);
      const to = path.join(destDir, `${id}.json`);
      try {
        await fs.link(from, to);
        await fs.unlink(from);
        return id;
      } catch (err) {
        if (err.code === 'EEXIST') continue;
        if (err.code !== 'EXDEV') throw err;
      }
      try {
        await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
        await fs.chmod(to, 0o600);
        await fs.unlink(from);
        return id;
      } catch (err) {
        if (err.code === 'EEXIST') continue;
        await fs.unlink(to).catch(() => {});
        throw err;
      }
    }
  }

  /** Copy the current file (if any) into .backups/ and trim old copies. */
  async _backup(id, file) {
    if (!(await this._exists(file))) return;
    await fs.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(this.backupDir, recoveryName(id));
    await fs.copyFile(file, backup, fsConstants.COPYFILE_EXCL);
    await fs.chmod(backup, 0o600);
    // Match only this tree's own timestamped backups — a loose prefix would
    // also match a sibling tree like "family-2" when trimming "family".
    // The optional suffix keeps pre-1.2.2 backups visible to rotation.
    const re = new RegExp(`^${escapeRe(id)}-\\d{4}(-\\d{2}){5}(?:-\\d{3}-[a-f0-9-]+)?\\.json$`);
    const backups = (await fs.readdir(this.backupDir)).filter(f => re.test(f)).sort();
    while (backups.length > MAX_BACKUPS) {
      await fs.unlink(path.join(this.backupDir, backups.shift()));
    }
  }
}
