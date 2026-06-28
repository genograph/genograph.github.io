/* ============================================================
 * Genograph — storage detection & orchestration
 *
 * One codebase, three backends. At startup pickStore() chooses:
 *   - serverStore : the page is served by the bundled Node server (GET /api/trees
 *                   succeeds) — trees are real files on disk via the local API.
 *   - fsStore     : a folder was previously chosen and its permission is still
 *                   granted — trees are real .json files in that folder.
 *   - idbStore    : otherwise — the universal browser fallback (IndexedDB),
 *                   seeded with the example tree on first run.
 *
 * openFolder() is the user-gesture path to pick (or re-grant) a folder; the
 * chosen directory handle is remembered in IndexedDB so it reconnects next time.
 * ============================================================ */
'use strict';

import { createServerStore } from './serverStore.js';
import { createIdbStore, getMeta, setMeta, delMeta } from './idbStore.js';
import { createFsStore } from './fsStore.js';

const HANDLE_KEY = 'dirHandle';
const PERM = { mode: 'readwrite' };

/** True when this browser supports picking a real folder (File System Access). */
export function supportsFolders() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// Query (and optionally request) read-write permission for a directory handle.
async function permission(handle, request) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'granted';
  let state = await handle.queryPermission(PERM);
  if (state !== 'granted' && request && typeof handle.requestPermission === 'function') {
    state = await handle.requestPermission(PERM);
  }
  return state;
}

// Is the bundled Node server answering the API? (false on a static host.)
async function serverAvailable() {
  try {
    const res = await fetch('/api/trees', { headers: { Accept: 'application/json' } });
    return res.ok;
  } catch { return false; }
}

async function browserDefault(savedHandle) {
  const store = createIdbStore();
  await store.seedIfEmpty();
  await store.persist();
  return { store, mode: 'idb', savedHandle: savedHandle || null };
}

/**
 * Choose the store for this environment.
 * @returns {Promise<{ store: object, mode: 'server'|'fs'|'idb', savedHandle: ?FileSystemDirectoryHandle }>}
 */
export async function pickStore() {
  if (await serverAvailable()) {
    return { store: createServerStore(), mode: 'server', savedHandle: null };
  }
  // Static / browser mode. Reconnect a previously chosen folder if still allowed.
  let savedHandle = null;
  try { savedHandle = (await getMeta(HANDLE_KEY)) || null; } catch { savedHandle = null; }
  if (savedHandle && supportsFolders()) {
    try {
      if (await permission(savedHandle, false) === 'granted') {
        return { store: createFsStore(savedHandle), mode: 'fs', savedHandle };
      }
    } catch { /* fall back to the browser default below */ }
  }
  return browserDefault(savedHandle);
}

/**
 * User-gesture path to use a real folder. If a folder was chosen before, try to
 * re-grant it first (no re-pick needed); otherwise open the native picker.
 * @returns {Promise<?{ store: object, mode: 'fs' }>} null if the user cancels.
 */
export async function openFolder(savedHandle) {
  if (savedHandle) {
    try {
      if (await permission(savedHandle, true) === 'granted') {
        await setMeta(HANDLE_KEY, savedHandle);
        return { store: createFsStore(savedHandle), mode: 'fs' };
      }
    } catch { /* fall through to a fresh pick */ }
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'genograph', mode: 'readwrite' });
  } catch (e) {
    if (e && e.name === 'AbortError') return null;   // user dismissed the picker
    throw e;
  }
  if (await permission(handle, true) !== 'granted') return null;
  await setMeta(HANDLE_KEY, handle);
  return { store: createFsStore(handle), mode: 'fs' };
}

/** Forget the chosen folder and fall back to in-browser (IndexedDB) storage. */
export async function useBrowserStorage() {
  try { await delMeta(HANDLE_KEY); } catch { /* ignore */ }
  return browserDefault(null);
}
