/* Tests for the HTTP server + JSON API (src/server.js), including security guards. */
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
const SEED = path.join(__dirname, '..', 'examples', 'lusignan.json');

let dir, server, port;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-server-'));
  const store = await new TreeStore(dir).init();
  await store.seedIfEmpty(SEED);
  server = createServer({ store, publicDir: PUBLIC });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  port = server.address().port;
});

after(async () => {
  await new Promise(res => server.close(res));
  await fs.rm(dir, { recursive: true, force: true });
});

/** Make a request. `headers.Host` defaults to a local host so the guard passes. */
function req(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    if (data != null && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data != null) r.write(data);
    r.end();
  });
}

test('GET /api/trees — lists the seeded example', async () => {
  const res = await req('GET', '/api/trees');
  assert.equal(res.status, 200);
  const lusignan = res.json.trees.find(t => t.id === 'lusignan');
  assert.ok(lusignan, 'lusignan present');
  assert.equal(lusignan.people, 18);
});

test('GET /api/trees/:id — reads a tree', async () => {
  const res = await req('GET', '/api/trees/lusignan');
  assert.equal(res.status, 200);
  assert.equal(res.json.people.length, 18);
});

test('full lifecycle — create, save, rename, duplicate, delete', async () => {
  const created = await req('POST', '/api/trees', { body: { name: 'Lifecycle' } });
  assert.equal(created.status, 201);
  const id = created.json.id;
  assert.equal(id, 'lifecycle');

  const saved = await req('PUT', `/api/trees/${id}`, {
    body: { summary: { name: 'Lifecycle' }, people: [{ id: 'p1', name: 'Solo' }] }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);
  assert.equal(saved.json.people, 1);

  const renamed = await req('PATCH', `/api/trees/${id}`, { body: { name: 'Renamed' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.name, 'Renamed');

  const dup = await req('POST', `/api/trees/${id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.notEqual(dup.json.id, id);

  const del = await req('DELETE', `/api/trees/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.ok, true);
  const after = await req('GET', `/api/trees/${id}`);
  assert.equal(after.status, 404, 'reading a deleted tree is 404');
});

test('POST /api/trees with data — imports', async () => {
  const res = await req('POST', '/api/trees', { body: { name: 'Imported', data: { people: [{ id: 'p1', name: 'A' }] } } });
  assert.equal(res.status, 201);
  const read = await req('GET', `/api/trees/${res.json.id}`);
  assert.equal(read.json.people.length, 1);
});

test('PUT with an invalid body → 400', async () => {
  const res = await req('PUT', '/api/trees/lusignan', { body: { nope: true } });
  assert.equal(res.status, 400);
  assert.ok(res.json.error);
});

test('malformed JSON body → 400', async () => {
  const res = await req('PUT', '/api/trees/lusignan', { body: '{ not json', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
});

test('unknown endpoint → 404, wrong method → 405', async () => {
  assert.equal((await req('GET', '/api/nope')).status, 404);
  assert.equal((await req('DELETE', '/api/trees')).status, 405);
});

test('SECURITY — rejects a non-local Host header (anti DNS-rebinding)', async () => {
  const res = await req('GET', '/api/trees', { headers: { Host: 'evil.example.com' } });
  assert.equal(res.status, 403);
});

test('SECURITY — rejects a cross-origin state-changing request (anti CSRF)', async () => {
  const res = await req('POST', '/api/trees', { body: { name: 'X' }, headers: { Origin: 'http://evil.example.com' } });
  assert.equal(res.status, 403);
});

test('SECURITY — allows a same-origin Origin header', async () => {
  const res = await req('POST', '/api/trees', { body: { name: 'Same Origin OK' }, headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(res.status, 201);
});

test('SECURITY — static path traversal is forbidden', async () => {
  const res = await req('GET', '/..%2f..%2fpackage.json');
  assert.equal(res.status, 403);
});

test('static — serves index.html with security headers', async () => {
  const res = await req('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.headers['content-security-policy'], 'CSP header present');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.text, /Famaile Tree/);
});

test('static — serves the ES module libraries', async () => {
  const res = await req('GET', '/lib/model.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('static — unknown file → 404', async () => {
  assert.equal((await req('GET', '/does-not-exist.js')).status, 404);
});
