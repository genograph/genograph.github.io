/* ============================================================
 * Famaile Tree — shared tree-store helpers (pure, no I/O)
 *
 * These small functions are reused by every storage backend (the Node file
 * store, the IndexedDB store and the File System Access store) so id rules,
 * slugging and the tree document shape stay identical everywhere. Nothing here
 * touches the filesystem, the network or the DOM — it is plain data in, data out.
 * ============================================================ */
'use strict';

import { isValidTree } from './model.js';

export const MAX_ID_LEN = 64;
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

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

/**
 * Pick a fresh id derived from a name, avoiding collisions with ids already in
 * use. `existing` may be a Set or any iterable of taken ids.
 */
export function uniqueId(existing, name) {
  const taken = existing instanceof Set ? existing : new Set(existing);
  const base = slugify(name) || 'tree';
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`.slice(0, MAX_ID_LEN);
  return id;
}

/** Lightweight library metadata (id, name, people count, updated_at) for a raw tree. */
export function treeMeta(raw, id) {
  if (!isValidTree(raw)) return { id, name: id, people: 0, updated_at: null, error: true };
  return {
    id,
    name: (raw.summary && raw.summary.name) || id,
    people: raw.people.length,
    updated_at: (raw.summary && raw.summary.last_modified) || null
  };
}

/** A new, empty tree document with the given display name. */
export function emptyTree(name) {
  const display = String(name ?? '').trim() || 'Untitled tree';
  return { summary: { name: display, total_people: 0 }, people: [] };
}

/** Set a raw tree's display name (mutates and returns it). */
export function withName(raw, name) {
  raw.summary = raw.summary || {};
  raw.summary.name = String(name ?? '').trim();
  return raw;
}

export { isValidTree };
