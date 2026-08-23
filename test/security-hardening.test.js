/* Regression tests for the security-hardening guarantees added in v1.2.2. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createServer } from '../src/server.js';
import { TreeStore } from '../src/store.js';
import { buildModel } from '../public/lib/model.js';

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function request(port, { method = 'GET', pathname = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('different localhost port is rejected as a mutating origin', async t => {
  const dir = await tempDir('genograph-csrf-');
  const store = await new TreeStore(dir).init();
  const server = createServer({ store });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const session = await request(port, { pathname: '/api/session' });
  const requestToken = JSON.parse(session.body).requestToken;
  const body = JSON.stringify({ name: 'Created cross-origin' });
  const res = await request(port, {
    method: 'POST',
    pathname: '/api/trees',
    headers: {
      Host: `127.0.0.1:${port}`,
      Origin: 'http://127.0.0.1:9999',
      'X-Genograph-Token': requestToken,
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });
  assert.equal(res.status, 403);
  assert.equal((await store.list()).length, 0);
});

test('a colliding maximum-length slug terminates with a valid distinct id', () => {
  const moduleUrl = new URL('../public/lib/treeStore.js', import.meta.url).href;
  const code = `import { uniqueId } from ${JSON.stringify(moduleUrl)}; const id = 'a'.repeat(64); console.log(uniqueId(new Set([id]), id));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 500 });
  assert.equal(result.status, 0);
  const generated = result.stdout.trim();
  assert.equal(generated.length, 64);
  assert.notEqual(generated, 'a'.repeat(64));
  assert.match(generated, /-2$/);
});

test('Node storage creates private directories and tree files', async t => {
  if (process.platform === 'win32') return t.skip('POSIX mode bits only');
  const base = await tempDir('genograph-mode-');
  const dir = path.join(base, 'trees');
  const old = process.umask(0o022);
  try {
    const store = await new TreeStore(dir).init();
    const { id } = await store.create('Private family');
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(store.pathFor(id))).mode & 0o777, 0o600);
  } finally {
    process.umask(old);
  }
});

test('the app-owned default-store migration tightens existing permissions', async t => {
  if (process.platform === 'win32') return t.skip('POSIX mode bits only');
  const dir = await tempDir('genograph-existing-mode-');
  const file = path.join(dir, 'family.json');
  await fs.writeFile(file, JSON.stringify({ people: [] }), { mode: 0o644 });
  await fs.chmod(dir, 0o755);

  await new TreeStore(dir).init({ secureExisting: true });
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('same-second backups remain distinct recovery points', async () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-08-23T00:00:00.000Z'])); }
    static now() { return RealDate.parse('2026-08-23T00:00:00.000Z'); }
  };
  try {
    const store = await new TreeStore(await tempDir('genograph-backup-')).init();
    const { id } = await store.create('Family');
    await store.write(id, { people: [], marker: 1 });
    await store.write(id, { people: [], marker: 2 });
    const backups = await fs.readdir(store.backupDir);
    assert.equal(backups.length, 2);
    const markers = await Promise.all(backups.map(async file =>
      JSON.parse(await fs.readFile(path.join(store.backupDir, file), 'utf8')).marker));
    assert.ok(markers.includes(1));
  } finally {
    globalThis.Date = RealDate;
  }
});

test('same-second deletions retain both trashed trees', async () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-08-23T00:00:00.000Z'])); }
    static now() { return RealDate.parse('2026-08-23T00:00:00.000Z'); }
  };
  try {
    const store = await new TreeStore(await tempDir('genograph-trash-')).init();
    let created = await store.create('Family');
    await store.write(created.id, { people: [], marker: 'first' });
    await store.delete(created.id);
    created = await store.create('Family');
    await store.write(created.id, { people: [], marker: 'second' });
    await store.delete(created.id);
    const trashed = await fs.readdir(store.trashDir);
    assert.equal(trashed.length, 2);
    const markers = await Promise.all(trashed.map(async file =>
      JSON.parse(await fs.readFile(path.join(store.trashDir, file), 'utf8')).marker));
    assert.deepEqual(markers.sort(), ['first', 'second']);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('move collision creates a valid destination id the store can list', async () => {
  const name = 'a'.repeat(64);
  const source = await new TreeStore(await tempDir('genograph-source-')).init();
  const destinationDir = await tempDir('genograph-destination-');
  const destination = await new TreeStore(destinationDir).init();
  await source.create(name);
  await destination.create(name);
  await source.moveTo(destinationDir);
  assert.equal((await fs.readdir(destinationDir)).filter(x => x.endsWith('.json')).length, 2);
  assert.equal((await destination.list()).length, 2);
  assert.ok((await destination.list()).every(tree => tree.id.length <= 64));
});

test('tree validation rejects a document that would crash model construction', async () => {
  const store = await new TreeStore(await tempDir('genograph-shape-')).init();
  await assert.rejects(() => store.write('malformed', { people: [null] }), /people\[0\] must be an object/);
  assert.throws(() => buildModel({ people: [null] }), /people\[0\] must be an object/);
});

test('simultaneous writes use independent temporary paths', async () => {
  const store = await new TreeStore(await tempDir('genograph-write-race-')).init();
  await store.create('Family');
  const payload = writer => ({ people: [], writer, padding: 'x'.repeat(250_000) });
  const results = await Promise.allSettled([
    store.write('family', payload(1)),
    store.write('family', payload(2))
  ]);
  assert.equal(results.filter(result => result.status === 'rejected').length, 0);
  await assert.doesNotReject(async () => JSON.parse(await fs.readFile(store.pathFor('family'), 'utf8')));
});

test('simultaneous creates allocate distinct tree ids', async () => {
  const store = await new TreeStore(await tempDir('genograph-create-race-')).init();
  const [first, second] = await Promise.all([store.create('Family'), store.create('Family')]);
  assert.deepEqual([first.id, second.id], ['family', 'family-2']);
  assert.equal((await store.list()).length, 2);
});
