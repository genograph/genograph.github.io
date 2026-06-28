/* Tests for the data-folder settings: config persistence and the /api/settings endpoint. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/server.js';
import { TreeStore } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

let dir, altDir, configDir, server, port, persisted;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-set-'));
  altDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-set-alt-'));
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-set-cfg-'));
  const store = await new TreeStore(dir).init();
  await store.write('start', { summary: { name: 'Start' }, people: [{ id: 'p1', name: 'A' }] });
  persisted = null;
  server = createServer({
    store, publicDir: PUBLIC,
    settings: { defaultDir: dir, locked: false, persist: async d => { persisted = d; } }
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  port = server.address().port;
});

after(async () => {
  await new Promise(res => server.close(res));
  for (const d of [dir, altDir, configDir]) await fs.rm(d, { recursive: true, force: true });
});

function req(method, p, { body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { Host: `127.0.0.1:${port}` };
    if (data != null) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data != null) r.write(data);
    r.end();
  });
}

test('GET /api/settings — reports the current data folder', async () => {
  const res = await req('GET', '/api/settings');
  assert.equal(res.status, 200);
  assert.equal(res.json.dataDir, path.resolve(dir));
  assert.equal(res.json.configurable, true);
  assert.equal(res.json.locked, false);
});

test('PUT /api/settings — switches folder and persists the choice', async () => {
  const res = await req('PUT', '/api/settings', { body: { dataDir: altDir } });
  assert.equal(res.status, 200);
  assert.equal(res.json.dataDir, path.resolve(altDir));
  assert.equal(persisted, path.resolve(altDir), 'choice was persisted');

  // the new (empty) folder is now active
  const list = await req('GET', '/api/trees');
  assert.equal(list.json.trees.length, 0);
});

test('PUT /api/settings with move — carries existing trees along', async () => {
  // currently pointed at altDir (empty); move back to a fresh folder taking nothing,
  // then verify a move from a populated folder relocates the tree.
  const populated = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-set-src-'));
  const store = await new TreeStore(populated).init();
  await store.write('keep', { people: [{ id: 'p1', name: 'Keep' }] });
  const srv = createServer({
    store, publicDir: PUBLIC,
    settings: { defaultDir: populated, locked: false, persist: async () => {} }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const p2 = srv.address().port;
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-set-dst-'));

  const put = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ dataDir: target, move: true });
    const r = http.request({ host: '127.0.0.1', port: p2, path: '/api/settings', method: 'PUT',
      headers: { Host: `127.0.0.1:${p2}`, 'Content-Type': 'application/json' } }, res => {
      const c = []; res.on('data', x => c.push(x));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8'))));
    });
    r.on('error', reject); r.write(body); r.end();
  });
  assert.equal(put.moved, 1, 'one tree moved');
  const movedFiles = (await fs.readdir(target)).filter(f => f.endsWith('.json'));
  assert.deepEqual(movedFiles, ['keep.json']);

  await new Promise(r => srv.close(r));
  await fs.rm(populated, { recursive: true, force: true });
  await fs.rm(target, { recursive: true, force: true });
});

test('PUT /api/settings — rejected (409) when the folder is locked', async () => {
  const store = await new TreeStore(dir).init();
  const srv = createServer({
    store, publicDir: PUBLIC,
    settings: { defaultDir: dir, locked: true, persist: async () => {} }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const p2 = srv.address().port;
  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ dataDir: altDir });
    const r = http.request({ host: '127.0.0.1', port: p2, path: '/api/settings', method: 'PUT',
      headers: { Host: `127.0.0.1:${p2}`, 'Content-Type': 'application/json' } }, res => {
      const c = []; res.on('data', x => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(c).toString('utf8')) }));
    });
    r.on('error', reject); r.write(body); r.end();
  });
  assert.equal(res.status, 409);
  assert.ok(res.json.error);
  await new Promise(r => srv.close(r));
});

test('PUT /api/settings — empty path is a 400', async () => {
  const res = await req('PUT', '/api/settings', { body: { dataDir: '   ' } });
  assert.equal(res.status, 400);
});
