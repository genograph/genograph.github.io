#!/usr/bin/env node
/* ============================================================
 * Genograph — command-line entry point
 * Resolves the data directory, seeds the example tree on first run,
 * starts the local server and opens the app in the browser.
 * ============================================================ */
'use strict';

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { TreeStore } from '../src/store.js';
import { readConfig, writeConfig, configPath } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED_FILE = path.join(ROOT, 'examples', 'lusignan.json');

const DEFAULTS = { port: 3456, host: '127.0.0.1', open: true };

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.genograph', 'trees');

function parseArgs(argv) {
  const opts = { ...DEFAULTS, data: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-p': case '--port': opts.port = parseInt(next(), 10); break;
      case '-d': case '--data': opts.data = next(); break;
      case '--host': opts.host = next(); break;
      case '--no-open': opts.open = false; break;
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      default:
        if (a.startsWith('--port=')) opts.port = parseInt(a.slice(7), 10);
        else if (a.startsWith('--data=')) opts.data = a.slice(7);
        else if (a.startsWith('--host=')) opts.host = a.slice(7);
        else { console.error(`Unknown option: ${a}\nTry --help.`); process.exit(2); }
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error('Invalid --port.'); process.exit(2);
  }
  return opts;
}

async function version() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function help() {
  return `Genograph — offline, private family-tree browser & editor

Usage: genograph [options]

Options:
  -p, --port <n>     Port to listen on            (default ${DEFAULTS.port})
  -d, --data <dir>   Folder to store your trees   (default ~/.genograph/trees)
      --host <addr>  Address to bind              (default ${DEFAULTS.host})
      --no-open      Don't open the browser automatically
  -h, --help         Show this help
  -v, --version      Show version

Environment:
  GENOGRAPH_DATA  Data folder for this run (same effect as --data)

The data folder can also be changed from inside the app (tree menu → "Data
folder"); that choice is remembered in ${configPath()} and used on the next
launch. A --data flag or GENOGRAPH_DATA pins the folder for one run and
takes priority over the remembered choice.

Your trees are stored as JSON files on your computer and never leave it.`;
}

/**
 * Decide which folder to store trees in, in priority order:
 *   1. --data / GENOGRAPH_DATA  → pins the folder for this run ("locked")
 *   2. the remembered choice in config.json
 *   3. the built-in default (~/.genograph/trees)
 */
async function resolveDataDir(opts) {
  const override = opts.data || process.env.GENOGRAPH_DATA;
  if (override) return { dir: path.resolve(override), locked: true };
  const cfg = await readConfig();
  if (cfg.dataDir) return { dir: path.resolve(cfg.dataDir), locked: false };
  return { dir: DEFAULT_DATA_DIR, locked: false };
}

/** Listen, retrying the next few ports if the chosen one is busy. */
function listen(server, host, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryListen = p => {
      const onError = err => {
        if (err.code === 'EADDRINUSE' && tries++ < attempts) {
          server.removeListener('error', onError);
          tryListen(p + 1);
        } else { reject(err); }
      };
      server.once('error', onError);
      server.listen(p, host, () => { server.removeListener('error', onError); resolve(p); });
    };
    tryListen(port);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* opening the browser is best-effort */ }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(help()); return; }
  if (opts.version) { console.log(await version()); return; }

  const { dir: dataDir, locked } = await resolveDataDir(opts);
  const store = await new TreeStore(dataDir).init();
  const seeded = await store.seedIfEmpty(SEED_FILE);

  const server = createServer({
    store,
    publicDir: PUBLIC_DIR,
    settings: {
      defaultDir: DEFAULT_DATA_DIR,
      locked,
      persist: dir => writeConfig({ dataDir: dir })
    }
  });

  let actualPort;
  try {
    actualPort = await listen(server, opts.host, opts.port);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${opts.port} (and the next few) are in use.\n  Try a different one:  genograph --port 8080\n`);
    } else if (err.code === 'EACCES') {
      console.error(`\n  Not allowed to bind ${opts.host}:${opts.port}. Try a port above 1024.\n`);
    } else {
      console.error(`\n  Could not start server: ${err.message}\n`);
    }
    process.exit(1);
  }

  const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${actualPort}`;
  const v = await version();
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log(`  │   🌳  Genograph  v${v.padEnd(26)}│`);
  console.log('  └─────────────────────────────────────────────┘');
  console.log(`  App        : ${url}`);
  console.log(`  Your trees : ${dataDir}`);
  if (seeded.seeded) console.log('  (Seeded the example tree on first run.)');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (opts.open) setTimeout(() => openBrowser(url), 600);

  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error(err); process.exit(1); });
