/* Tests for tree file storage (src/store.js). */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TreeStore, isValidId, slugify } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.join(__dirname, '..', 'examples', 'lusignan.json');

let dir, store;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-store-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  // fresh empty data dir for each test
  await fs.rm(dir, { recursive: true, force: true });
  store = await new TreeStore(dir).init();
});

test('isValidId — accepts slugs, rejects unsafe ids', () => {
  for (const ok of ['lusignan', 'my-tree', 'a', 'tree_2', 'x1']) assert.ok(isValidId(ok), ok);
  for (const bad of ['', '../etc', 'a/b', 'a\\b', '.hidden', 'UPPER', 'a.b', 'spaces here', 'a'.repeat(65)]) {
    assert.ok(!isValidId(bad), bad);
  }
});

test('slugify — produces safe ids', () => {
  assert.equal(slugify('My Family Tree'), 'my-family-tree');
  assert.equal(slugify('Côté & Müller!!'), 'cote-muller');
  assert.equal(slugify('   '), '');
});

test('pathFor — refuses to escape the data directory', () => {
  for (const bad of ['../secret', 'a/b', '..', 'foo.bar']) {
    assert.throws(() => store.pathFor(bad), /Invalid tree id/, bad);
  }
  assert.ok(store.pathFor('ok-tree').startsWith(path.resolve(dir)));
});

test('create / list / read', async () => {
  const { id } = await store.create('My Family');
  assert.equal(id, 'my-family');
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.deepEqual(
    { id: list[0].id, name: list[0].name, people: list[0].people },
    { id: 'my-family', name: 'My Family', people: 0 }
  );
  const data = await store.read(id);
  assert.deepEqual(data.people, []);
  assert.equal(data.summary.name, 'My Family');
});

test('create — unique ids when names collide', async () => {
  const a = await store.create('Smith');
  const b = await store.create('Smith');
  assert.equal(a.id, 'smith');
  assert.equal(b.id, 'smith-2');
});

test('write — validates structure', async () => {
  await assert.rejects(() => store.write('t', { nope: true }), /people/);
  await assert.rejects(() => store.write('t', null), /people/);
  await store.write('t', { people: [{ id: 'p1', name: 'A' }] }); // ok
  assert.equal((await store.read('t')).people.length, 1);
});

test('write — atomic (no leftover .tmp) and backs up the previous version', async () => {
  const { id } = await store.create('Doc');
  await store.write(id, { summary: { name: 'Doc' }, people: [{ id: 'p1', name: 'First' }] });
  await store.write(id, { summary: { name: 'Doc' }, people: [{ id: 'p1', name: 'Second' }] });

  const entries = await fs.readdir(dir);
  assert.ok(!entries.some(f => f.endsWith('.tmp')), 'no temp files left behind');

  const backups = await fs.readdir(path.join(dir, '.backups'));
  assert.ok(backups.length >= 1, 'a backup was made before overwriting');
  assert.equal((await store.read(id)).people[0].name, 'Second');
});

test('backup rotation — keeps at most MAX_BACKUPS per tree', async () => {
  const { id } = await store.create('Rotate');
  for (let i = 0; i < 55; i++) {
    // eslint-disable-next-line no-await-in-loop
    await store.write(id, { people: [{ id: 'p1', name: 'v' + i }] });
    // distinct backup filenames need distinct timestamps (seconds); fake by sleeping is too slow,
    // so we just assert the cap holds with whatever granularity the clock gives us.
  }
  const backups = (await fs.readdir(path.join(dir, '.backups'))).filter(f => f.startsWith('rotate-'));
  assert.ok(backups.length <= 50, `expected <=50 backups, got ${backups.length}`);
});

test('rename — changes display name, keeps id', async () => {
  const { id } = await store.create('Old Name');
  await store.rename(id, 'New Name');
  assert.equal((await store.read(id)).summary.name, 'New Name');
  const list = await store.list();
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, 'New Name');
});

test('duplicate — copies content under a new id', async () => {
  const { id } = await store.create('Original');
  await store.write(id, { summary: { name: 'Original' }, people: [{ id: 'p1', name: 'X' }] });
  const dup = await store.duplicate(id);
  assert.notEqual(dup.id, id);
  assert.match(dup.name, /copy/i);
  assert.equal((await store.read(dup.id)).people.length, 1);
  assert.equal((await store.list()).length, 2);
});

test('delete — moves the tree to .trash (recoverable)', async () => {
  const { id } = await store.create('Doomed');
  await store.delete(id);
  assert.equal((await store.list()).length, 0);
  const trash = await fs.readdir(path.join(dir, '.trash'));
  assert.ok(trash.some(f => f.startsWith('doomed-')), 'file moved to trash, not destroyed');
});

test('moveTo — relocates tree files, avoids clobbering, leaves source empty', async () => {
  await store.write('a', { people: [{ id: 'p1', name: 'A' }] });
  await store.write('b', { people: [{ id: 'p1', name: 'B' }] });

  const destDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-move-'));
  // a tree named "a" already exists at the destination → must not be overwritten
  await new TreeStore(destDir).init();
  await fs.writeFile(path.join(destDir, 'a.json'),
    JSON.stringify({ people: [{ id: 'p1', name: 'pre-existing' }] }));

  const moved = await store.moveTo(destDir);
  assert.deepEqual(moved.sort(), ['a', 'b']);
  assert.equal((await store.list()).length, 0, 'source folder is emptied');

  const destFiles = (await fs.readdir(destDir)).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(destFiles, ['a-2.json', 'a.json', 'b.json'], 'collision suffixed, originals kept');
  const preserved = JSON.parse(await fs.readFile(path.join(destDir, 'a.json'), 'utf8'));
  assert.equal(preserved.people[0].name, 'pre-existing');

  await fs.rm(destDir, { recursive: true, force: true });
});

test('importTree — validates and stores', async () => {
  await assert.rejects(() => store.importTree('bad', { nope: 1 }), /valid tree/);
  const r = await store.importTree('Imported', { people: [{ id: 'p1', name: 'A' }] });
  assert.equal((await store.read(r.id)).summary.name, 'Imported');
});

test('seedIfEmpty — seeds once, then is a no-op', async () => {
  const first = await store.seedIfEmpty(SEED);
  assert.equal(first.seeded, true);
  assert.equal(first.id, 'lusignan');
  assert.equal((await store.read('lusignan')).people.length, 18);

  const second = await store.seedIfEmpty(SEED);
  assert.equal(second.seeded, false, 'does not seed again when trees already exist');
  assert.equal((await store.list()).length, 1);
});

test('list — skips dotfiles and unparseable files without throwing', async () => {
  await store.create('Good');
  await fs.writeFile(path.join(dir, 'broken.json'), '{ not json');
  await fs.writeFile(path.join(dir, '.hidden.json'), '{}');
  const list = await store.list();
  const ids = list.map(t => t.id);
  assert.ok(ids.includes('good'));
  assert.ok(ids.includes('broken'), 'broken file is listed (flagged), not fatal');
  assert.ok(list.find(t => t.id === 'broken').error, 'broken file flagged with error');
  assert.ok(!ids.includes('.hidden'), 'dotfiles ignored');
});
