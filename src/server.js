/* ============================================================
 * Famaile Tree — local HTTP server + JSON API
 *
 * Serves the static app from /public and exposes a small REST API over the
 * tree store. Designed to be reachable only from this machine:
 *   - binds to a loopback address (the CLI passes 127.0.0.1)
 *   - rejects requests whose Host is not localhost (anti DNS-rebinding)
 *   - rejects cross-origin state-changing requests (anti CSRF)
 *   - static paths are confined to /public; tree ids to the data dir
 * No dependencies — plain Node.js.
 * ============================================================ */
'use strict';

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TreeStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = path.resolve(__dirname, '..', 'public');

const MAX_BODY = 25 * 1024 * 1024;   // 25 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Hostnames that are unambiguously this machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostnameOf(value) {
  if (!value) return null;
  let h = String(value).trim();
  // strip scheme if present (Origin/Referer), then path
  h = h.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  // [::1]:port  |  host:port  |  host
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1) || h;
  const colon = h.lastIndexOf(':');
  return colon > -1 ? h.slice(0, colon) : h;
}

const isLocalHost = value => LOCAL_HOSTS.has(hostnameOf(value));

function securityHeaders(type) {
  return {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer'
  };
}

function send(res, code, body, type) {
  res.writeHead(code, securityHeaders(type));
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), MIME['.json']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { code: 'E2BIG' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return undefined;
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { code: 'EBADJSON' }); }
}

function statusForError(err) {
  switch (err && err.code) {
    case 'EBADID':
    case 'EBADTREE':
    case 'EBADNAME':
    case 'EBADDIR':
    case 'EBADJSON': return 400;
    case 'ELOCKED': return 409;
    case 'E2BIG': return 413;
    case 'ENOENT': return 404;
    default: return 500;
  }
}

/** Expand a leading ~ and resolve a user-typed folder path to an absolute one. */
function resolveUserDir(input) {
  let s = String(input ?? '').trim();
  if (!s) throw Object.assign(new Error('A folder path is required.'), { code: 'EBADDIR' });
  if (s.includes('\0')) throw Object.assign(new Error('Invalid folder path.'), { code: 'EBADDIR' });
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(os.homedir(), s.slice(1));
  return path.resolve(s);
}

/**
 * Create the HTTP server.
 *
 * `settings` makes the data folder changeable from the UI:
 *   - defaultDir : the built-in default, shown as a hint
 *   - locked     : true when --data / FAMAILE_TREE_DATA pinned it for this run
 *   - persist    : async (dir) => void, remembers the choice across launches
 *
 * @param {{ store: import('./store.js').TreeStore, publicDir?: string,
 *           settings?: { defaultDir?: string, locked?: boolean, persist?: (dir: string) => Promise<void> } }} opts
 * @returns {http.Server}
 */
export function createServer({ store, publicDir = DEFAULT_PUBLIC, settings = {} }) {
  const PUBLIC = path.resolve(publicDir);
  // The active store can be swapped at runtime, so handlers read it through `state`.
  const state = {
    store,
    defaultDir: path.resolve(settings.defaultDir || store.dir),
    locked: !!settings.locked,
    persist: settings.persist || null
  };

  return http.createServer(async (req, res) => {
    try {
      // ---- network safety: only serve this machine ----
      if (!isLocalHost(req.headers.host)) {
        return send(res, 403, 'Forbidden: non-local Host header.');
      }
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating) {
        const origin = req.headers.origin;
        const referer = req.headers.referer;
        if ((origin && !isLocalHost(origin)) || (referer && !isLocalHost(referer))) {
          return send(res, 403, 'Forbidden: cross-origin request.');
        }
      }

      const url = new URL(req.url, 'http://localhost');
      const segments = url.pathname.split('/').filter(Boolean);

      if (segments[0] === 'api') {
        return await handleApi(req, res, segments.slice(1), state);
      }
      return await handleStatic(req, res, url.pathname, PUBLIC);
    } catch (err) {
      sendJson(res, statusForError(err), { error: err.message || 'Server error' });
    }
  });
}

/* ---------------- API ---------------- */
async function handleApi(req, res, seg, state) {
  // seg: ['settings'] | ['trees'] | ['trees', id] | ['trees', id, 'duplicate']
  if (seg[0] === 'settings' && seg.length === 1) return handleSettings(req, res, state);
  if (seg[0] !== 'trees') return sendJson(res, 404, { error: 'Unknown endpoint' });

  const store = state.store;

  // /api/trees
  if (seg.length === 1) {
    if (req.method === 'GET') return sendJson(res, 200, { trees: await store.list() });
    if (req.method === 'POST') {
      const body = (await readJsonBody(req)) || {};
      const result = body.data !== undefined
        ? await store.importTree(body.name, body.data)
        : await store.create(body.name);
      return sendJson(res, 201, result);
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const id = seg[1];

  // /api/trees/:id/duplicate
  if (seg.length === 3 && seg[2] === 'duplicate') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 201, await store.duplicate(id));
  }

  // /api/trees/:id
  if (seg.length === 2) {
    if (req.method === 'GET') return sendJson(res, 200, await store.read(id));
    if (req.method === 'PUT') {
      const data = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, ...(await store.write(id, data)) });
    }
    if (req.method === 'PATCH') {
      const body = (await readJsonBody(req)) || {};
      return sendJson(res, 200, await store.rename(id, body.name));
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { ok: true, ...(await store.delete(id)) });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  return sendJson(res, 404, { error: 'Unknown endpoint' });
}

/* ---------------- settings (data folder) ---------------- */
const settingsView = state => ({
  dataDir: state.store.dir,
  defaultDir: state.defaultDir,
  configurable: !state.locked && !!state.persist,
  locked: state.locked
});

async function handleSettings(req, res, state) {
  if (req.method === 'GET') return sendJson(res, 200, settingsView(state));
  if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });

  if (state.locked || !state.persist) {
    throw Object.assign(
      new Error('The data folder is fixed for this session (set with --data or FAMAILE_TREE_DATA) and cannot be changed here.'),
      { code: 'ELOCKED' });
  }

  const body = (await readJsonBody(req)) || {};
  const target = resolveUserDir(body.dataDir);
  if (target === state.store.dir) return sendJson(res, 200, { ...settingsView(state), moved: 0 });

  let nextStore;
  try {
    nextStore = await new TreeStore(target).init();   // creates the folder if needed
  } catch (err) {
    throw Object.assign(new Error(`Could not use that folder: ${err.message}`), { code: 'EBADDIR' });
  }

  const moved = body.move ? await state.store.moveTo(target) : [];
  state.store = nextStore;
  await state.persist(target);
  return sendJson(res, 200, { ...settingsView(state), moved: moved.length });
}

/* ---------------- static files ---------------- */
async function handleStatic(req, res, pathname, PUBLIC) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }
  let rel;
  try { rel = decodeURIComponent(pathname); }
  catch { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.join(PUBLIC, rel);
  const within = path.relative(PUBLIC, file);
  if (within.startsWith('..') || path.isAbsolute(within)) {
    return send(res, 403, 'Forbidden');
  }
  try {
    const buf = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, securityHeaders(type));
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch {
    send(res, 404, 'Not found');
  }
}

export { isLocalHost, hostnameOf };
