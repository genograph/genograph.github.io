/* ============================================================
 * Famaile Tree — server storage backend
 *
 * The original behaviour: talk to the local Node server's /api/trees endpoints.
 * Selected by pickStore() when the page is served by the bundled HTTP server.
 * The JSON shapes returned here match what the browser stores return, so the UI
 * does not care which backend is active.
 * ============================================================ */
'use strict';

/** Fetch the JSON API, throwing a useful Error on any non-2xx response. */
async function api(path, opts) {
  const res = await fetch('/api/' + path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
  return body;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const enc = encodeURIComponent;

/** Create the server-backed store. */
export function createServerStore() {
  return {
    kind: 'server',
    async list() { return (await api('trees')).trees || []; },
    read(id) { return api('trees/' + enc(id)); },
    write(id, data) { return api('trees/' + enc(id), json('PUT', data)); },
    create(name) { return api('trees', json('POST', { name })); },
    rename(id, name) { return api('trees/' + enc(id), json('PATCH', { name })); },
    duplicate(id) { return api('trees/' + enc(id) + '/duplicate', { method: 'POST' }); },
    delete(id) { return api('trees/' + enc(id), { method: 'DELETE' }); },
    importTree(name, data) { return api('trees', json('POST', { name, data })); },

    // Server-only: the data-folder picker is backed by /api/settings.
    getSettings() { return api('settings'); },
    putSettings(body) { return api('settings', json('PUT', body)); }
  };
}
