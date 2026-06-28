/* ============================================================
 * Famaile Tree — tree file storage
 *
 * Each family tree is one JSON file in the data directory. Saving first copies
 * the previous version into `.backups/` (newest kept). All ids are validated
 * and every resolved path is asserted to stay inside the data directory, so a
 * crafted id can never read or write outside it.
 * ============================================================ */
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BACKUPS = 50;          // per tree
const MAX_ID_LEN = 64;
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const BACKUP_DIR = '.backups';
const TRASH_DIR = '.trash';

/** True for a safe tree id (lowercase slug, no path separators or dots). */
export function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && ID_RE.test(id);
}

/** Turn an arbitrary name into a safe id slug (may be empty -> caller adds fallback). */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LEN)
    .replace(/-+$/g, '');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function timestamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

export class TreeStore {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir);
    this.backupDir = path.join(this.dir, BACKUP_DIR);
    this.trashDir = path.join(this.dir, TRASH_DIR);
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
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
    while (await this._exists(this.pathFor(id))) { id = `${base}-${n++}`.slice(0, MAX_ID_LEN); }
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
    return JSON.parse(buf);
  }

  /** Validate, back up the previous version, then atomically write a tree. */
  async write(id, data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.people)) {
      throw Object.assign(new Error('A tree must be an object with a "people" array.'), { code: 'EBADTREE' });
    }
    const file = this.pathFor(id);
    await fs.mkdir(this.dir, { recursive: true });
    await this._backup(id, file);
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
    await fs.rename(tmp, file);   // atomic on the same filesystem
    return { id, people: data.people.length };
  }

  /** Create a new, empty tree with the given display name. */
  async create(name) {
    const display = String(name ?? '').trim() || 'Untitled tree';
    const id = await this.uniqueId(display);
    const data = { summary: { name: display, total_people: 0 }, people: [] };
    await this.write(id, data);
    return { id, name: display };
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
    const data = await this.read(id);
    const base = (data.summary && data.summary.name) || id;
    const display = `${base} (copy)`;
    const newId = await this.uniqueId(display);
    data.summary = data.summary || {};
    data.summary.name = display;
    await this.write(newId, data);
    return { id: newId, name: display };
  }

  /** Import an external tree object as a new tree. */
  async importTree(name, data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.people)) {
      throw Object.assign(new Error('Not a valid tree file.'), { code: 'EBADTREE' });
    }
    const display = String(name ?? '').trim() || (data.summary && data.summary.name) || 'Imported tree';
    const id = await this.uniqueId(display);
    data.summary = data.summary || {};
    data.summary.name = display;
    await this.write(id, data);
    return { id, name: display };
  }

  /** Move a tree to the trash folder (recoverable; not a hard delete). */
  async delete(id) {
    const file = this.pathFor(id);
    await fs.mkdir(this.trashDir, { recursive: true });
    const dest = path.join(this.trashDir, `${id}-${timestamp()}.json`);
    await fs.rename(file, dest);
    return { id, trashed: path.basename(dest) };
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

  /** Copy the current file (if any) into .backups/ and trim old copies. */
  async _backup(id, file) {
    if (!(await this._exists(file))) return;
    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.copyFile(file, path.join(this.backupDir, `${id}-${timestamp()}.json`));
    const re = new RegExp(`^${escapeRe(id)}-.*\\.json$`);
    const backups = (await fs.readdir(this.backupDir)).filter(f => re.test(f)).sort();
    while (backups.length > MAX_BACKUPS) {
      await fs.unlink(path.join(this.backupDir, backups.shift()));
    }
  }
}
