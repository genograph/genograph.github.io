/* ============================================================
 * Famaile Tree — persistent app settings
 *
 * A tiny JSON config file in the user's home folder (`~/.famaile-tree/config.json`)
 * that remembers preferences across launches. Today it stores one thing: the
 * folder your trees are saved in, so a custom location (e.g. your Desktop) sticks
 * the next time you start the app. The location can be redirected for one session
 * with the --data flag or FAMAILE_TREE_DATA, which never touches this file.
 * ============================================================ */
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = process.env.FAMAILE_TREE_CONFIG_DIR || path.join(os.homedir(), '.famaile-tree');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Absolute path of the config file (handy for messages and tests). */
export function configPath() { return CONFIG_FILE; }

/** Read the saved config, or an empty object if it is missing or unreadable. */
export async function readConfig() {
  try {
    const obj = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}

/** Merge a patch into the saved config and write it back atomically. */
export async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n');
  await fs.rename(tmp, CONFIG_FILE);   // atomic on the same filesystem
  return next;
}
