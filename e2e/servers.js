import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/server.js';
import { TreeStore } from '../src/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'genograph-e2e-'));
const treeDir = path.join(tempDir, 'trees');
const store = await new TreeStore(treeDir).init();
await store.seedIfEmpty(path.join(root, 'examples', 'lusignan.json'));

const local = createServer({ store, publicDir: path.join(root, 'public') });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png']
]);

const hosted = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = pathname.startsWith('/examples/') ? root : path.join(root, 'public');
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = path.resolve(base, relative);
    if (path.relative(base, file).startsWith('..')) throw new Error('Forbidden');
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mime.get(path.extname(file)) || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

await Promise.all([listen(local, 3456), listen(hosted, 4173)]);
console.log('Genograph E2E servers ready');

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all([local, hosted].map(server => new Promise(resolve => server.close(resolve))));
  await fs.rm(tempDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
