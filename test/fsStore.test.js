/* Tests for the File System Access backend (public/lib/fsStore.js).
 *
 * The real File System Access API only exists in the browser, so here we drive
 * the store through an in-memory fake directory handle that implements the small
 * subset of the API the store uses (entries / getFileHandle / getDirectoryHandle
 * / removeEntry + getFile / createWritable). This exercises the real store logic
 * — listing, backups, trash, unique ids — without a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFsStore } from '../public/lib/fsStore.js';

/* ---- minimal in-memory File System Access directory handle ---- */
class FakeWritable {
  constructor(file) { this.file = file; this._buf = ''; }
  async write(chunk) { this._buf += chunk; }
  async close() { this.file.contents = this._buf; }
}
class FakeFile {
  constructor(name) { this.kind = 'file'; this.name = name; this.contents = ''; }
  async getFile() { const c = this.contents; return { async text() { return c; } }; }
  async createWritable() { return new FakeWritable(this); }
}
class FakeDir {
  constructor(name = 'family-trees') { this.kind = 'directory'; this.name = name; this.children = new Map(); }
  async *entries() { for (const [k, v] of this.children) yield [k, v]; }
  async getFileHandle(name, opts = {}) {
    let f = this.children.get(name);
    if (!f) { if (!opts.create) throw notFound(name); f = new FakeFile(name); this.children.set(name, f); }
    if (f.kind !== 'file') throw notFound(name);
    return f;
  }
  async getDirectoryHandle(name, opts = {}) {
    let d = this.children.get(name);
    if (!d) { if (!opts.create) throw notFound(name); d = new FakeDir(name); this.children.set(name, d); }
    if (d.kind !== 'directory') throw notFound(name);
    return d;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw notFound(name); }
}
function notFound(name) { return Object.assign(new Error(`Not found: ${name}`), { name: 'NotFoundError' }); }

const ids = dir => [...dir.children.keys()].filter(n => n.endsWith('.json')).sort();
const readFile = async (dir, name) => {
  const file = await (await dir.getFileHandle(name)).getFile();
  return JSON.parse(await file.text());
};

test('fsStore — create / list / read round-trips through real files', async () => {
  const dir = new FakeDir();
  const store = createFsStore(dir);

  const { id } = await store.create('My Family');
  assert.equal(id, 'my-family');
  assert.deepEqual(ids(dir), ['my-family.json']);

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.deepEqual({ id: list[0].id, name: list[0].name, people: list[0].people },
    { id: 'my-family', name: 'My Family', people: 0 });

  const data = await store.read(id);
  assert.deepEqual(data.people, []);
  assert.equal(data.summary.name, 'My Family');
});

test('fsStore — unique ids when names collide', async () => {
  const store = createFsStore(new FakeDir());
  assert.equal((await store.create('Smith')).id, 'smith');
  assert.equal((await store.create('Smith')).id, 'smith-2');
});

test('fsStore — write validates structure and backs up the previous version', async () => {
  const dir = new FakeDir();
  const store = createFsStore(dir);
  await assert.rejects(() => store.write('t', { nope: true }), /people/);

  await store.write('doc', { summary: { name: 'Doc' }, people: [{ id: 'p1', name: 'First' }] });
  await store.write('doc', { summary: { name: 'Doc' }, people: [{ id: 'p1', name: 'Second' }] });

  assert.equal((await store.read('doc')).people[0].name, 'Second');
  const backups = await dir.getDirectoryHandle('.backups');
  const names = [...backups.children.keys()];
  assert.equal(names.length, 1, 'one backup of the pre-overwrite version');
  assert.ok(names[0].startsWith('doc-'));
  const backed = await readFile(backups, names[0]);
  assert.equal(backed.people[0].name, 'First', 'backup holds the previous content');
});

test('fsStore — invalid ids are refused, not written outside the folder', async () => {
  const store = createFsStore(new FakeDir());
  for (const bad of ['../secret', 'a/b', '..', 'UPPER']) {
    await assert.rejects(() => store.write(bad, { people: [] }), /Invalid tree id/, bad);
    await assert.rejects(() => store.read(bad), /Invalid tree id/, bad);
  }
});

test('fsStore — rename keeps id, duplicate copies under a new id', async () => {
  const store = createFsStore(new FakeDir());
  const { id } = await store.create('Original');
  await store.rename(id, 'Renamed');
  assert.equal((await store.read(id)).summary.name, 'Renamed');

  const dup = await store.duplicate(id);
  assert.notEqual(dup.id, id);
  assert.match(dup.name, /copy/i);
  assert.equal((await store.list()).length, 2);
});

test('fsStore — delete moves the tree to .trash (recoverable)', async () => {
  const dir = new FakeDir();
  const store = createFsStore(dir);
  await store.write('doomed', { people: [{ id: 'p1', name: 'X' }] });
  await store.delete('doomed');

  assert.equal((await store.list()).length, 0);
  assert.ok(!dir.children.has('doomed.json'), 'original file removed');
  const trash = await dir.getDirectoryHandle('.trash');
  const names = [...trash.children.keys()];
  assert.ok(names.some(n => n.startsWith('doomed-')), 'a recoverable copy is in .trash');
});

test('fsStore — list skips dotfiles and flags unparseable files', async () => {
  const dir = new FakeDir();
  const store = createFsStore(dir);
  await store.create('Good');
  // a broken file and a dotfile placed directly in the folder
  (await dir.getFileHandle('broken.json', { create: true })).contents = '{ not json';
  (await dir.getFileHandle('.hidden.json', { create: true })).contents = '{}';

  const list = await store.list();
  const byId = Object.fromEntries(list.map(t => [t.id, t]));
  assert.ok(byId.good);
  assert.ok(byId.broken && byId.broken.error, 'broken file is listed and flagged');
  assert.ok(!byId['.hidden'], 'dotfiles ignored');
});

test('fsStore — importTree validates and stores under a slugged id', async () => {
  const store = createFsStore(new FakeDir());
  await assert.rejects(() => store.importTree('bad', { nope: 1 }), /valid tree/);
  const r = await store.importTree('Imported', { people: [{ id: 'p1', name: 'A' }] });
  assert.equal((await store.read(r.id)).summary.name, 'Imported');
});
