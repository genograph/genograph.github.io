/* Tests for the shared, pure tree-store helpers (public/lib/treeStore.js).
 * These run in plain Node — no DOM, no filesystem, no IndexedDB. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  slugify, isValidId, uniqueId, treeMeta, emptyTree, withName, MAX_ID_LEN
} from '../public/lib/treeStore.js';

test('slugify — produces safe ids', () => {
  assert.equal(slugify('My Family Tree'), 'my-family-tree');
  assert.equal(slugify('Côté & Müller!!'), 'cote-muller');
  assert.equal(slugify('   '), '');
  assert.equal(slugify('---leading and trailing---'), 'leading-and-trailing');
  assert.ok(slugify('x'.repeat(200)).length <= MAX_ID_LEN, 'capped at MAX_ID_LEN');
});

test('isValidId — accepts slugs, rejects unsafe ids', () => {
  for (const ok of ['lusignan', 'my-tree', 'a', 'tree_2', 'x1']) assert.ok(isValidId(ok), ok);
  for (const bad of ['', '../etc', 'a/b', 'a\\b', '.hidden', 'UPPER', 'a.b', 'spaces here', 'a'.repeat(65), null, 42]) {
    assert.ok(!isValidId(bad), String(bad));
  }
});

test('uniqueId — derives from name and avoids collisions', () => {
  assert.equal(uniqueId(new Set(), 'Smith'), 'smith');
  assert.equal(uniqueId(new Set(['smith']), 'Smith'), 'smith-2');
  assert.equal(uniqueId(['smith', 'smith-2'], 'Smith'), 'smith-3', 'accepts any iterable of ids');
  assert.equal(uniqueId(new Set(), '   '), 'tree', 'empty slug falls back to "tree"');
  assert.ok(isValidId(uniqueId(new Set(), 'Çetin!!')), 'result is always a valid id');
});

test('treeMeta — summarizes a raw tree; flags invalid input', () => {
  const raw = { summary: { name: 'House', last_modified: '2026-01-01' }, people: [{ id: 'p1' }, { id: 'p2' }] };
  assert.deepEqual(treeMeta(raw, 'house'), { id: 'house', name: 'House', people: 2, updated_at: '2026-01-01' });

  // missing summary name falls back to the id; missing timestamp is null
  assert.deepEqual(treeMeta({ people: [] }, 'noname'), { id: 'noname', name: 'noname', people: 0, updated_at: null });

  // not a tree -> flagged with error, never throws
  const bad = treeMeta({ nope: true }, 'broken');
  assert.equal(bad.id, 'broken');
  assert.equal(bad.error, true);
});

test('emptyTree — a valid, named, empty document', () => {
  assert.deepEqual(emptyTree('Hi'), { summary: { name: 'Hi', total_people: 0 }, people: [] });
  assert.equal(emptyTree('  ').summary.name, 'Untitled tree', 'blank name gets a fallback');
});

test('withName — sets the display name in place', () => {
  const raw = { people: [] };
  const out = withName(raw, '  New Name  ');
  assert.equal(out, raw, 'returns the same object (mutates in place)');
  assert.equal(out.summary.name, 'New Name', 'trimmed');

  const existing = { summary: { name: 'Old', root: 'p1' }, people: [] };
  withName(existing, 'Renamed');
  assert.equal(existing.summary.name, 'Renamed');
  assert.equal(existing.summary.root, 'p1', 'other summary fields are preserved');
});
