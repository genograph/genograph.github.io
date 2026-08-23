/* Tests for the local API client and its per-process request token. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createServerStore } from '../public/lib/serverStore.js';

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; }
});

test('serverStore — attaches and refreshes the local request token', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  let session = 0;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts: { ...opts, headers: { ...(opts.headers || {}) } } });
    if (url === '/api/session') return response(200, { requestToken: ++session === 1 ? 'alpha' : 'beta' });
    if (url === '/api/trees' && opts.method === 'POST') {
      assert.equal(opts.headers['X-Genograph-Token'], 'alpha');
      return response(201, { id: 'family', name: 'Family' });
    }
    if (url === '/api/trees/family' && opts.method === 'PUT') {
      return opts.headers['X-Genograph-Token'] === 'alpha'
        ? response(403, { error: 'expired' })
        : response(200, { ok: true, id: 'family', people: 0 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const store = createServerStore();
  assert.equal((await store.create('Family')).id, 'family');
  assert.equal((await store.write('family', { people: [] })).ok, true);

  assert.equal(calls.filter(call => call.url === '/api/session').length, 2);
  const retries = calls.filter(call => call.url === '/api/trees/family');
  assert.deepEqual(retries.map(call => call.opts.headers['X-Genograph-Token']), ['alpha', 'beta']);
});
