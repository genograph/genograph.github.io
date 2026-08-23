/* ============================================================
 * Genograph — persistent app settings
 *
 * A tiny JSON config file in the user's home folder (`~/.genograph/config.json`)
 * that remembers preferences across launches. Today it stores one thing: the
 * folder your trees are saved in, so a custom location (e.g. your Desktop) sticks
 * the next time you start the app. The location can be redirected for one session
 * with the --data flag or GENOGRAPH_DATA, which never touches this file.
 * ============================================================ */
'use strict';

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = process.env.GENOGRAPH_CONFIG_DIR || path.join(os.homedir(), '.genograph');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Absolute path of the config file (handy for messages and tests). */
export function configPath() { return CONFIG_FILE; }

/** Read the saved config, or an empty object if it is missing or unreadable. */
export async function readConfig() {
  try {
    const obj = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    if (process.platform !== 'win32') {
      await fs.chmod(CONFIG_DIR, 0o700).catch(() => {});
      await fs.chmod(CONFIG_FILE, 0o600).catch(() => {});
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    if (obj.dataDir !== undefined && (typeof obj.dataDir !== 'string' || obj.dataDir.includes('\0'))) return {};
    return obj;
  } catch { return {}; }
}

/** Merge a patch into the saved config and write it back atomically. */
export async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(CONFIG_DIR, 0o700);
  const tmp = `${CONFIG_FILE}.${process.pid}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, CONFIG_FILE);   // atomic on the same filesystem
    renamed = true;
  } finally {
    if (!renamed) await fs.unlink(tmp).catch(() => {});
  }
  return next;
}
