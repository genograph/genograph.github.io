# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Mobile-friendly touch & layout.** The canvas now supports two-finger
  **pinch-to-zoom** (and two-finger pan) on phones and tablets, in addition to the
  existing one-finger pan, so the tree is fully navigable by touch without reaching for
  the on-screen zoom buttons. On narrow screens the header compacts (the segmented view
  control moves to its own full-width row, secondary stats hide) and the person editor
  panel expands to fill the screen instead of clipping off the right edge.
- **First-run welcome popup.** A small, well-designed dialog on the first visit explains
  what Genograph is, its privacy model, and how to use it (click a person, add relatives,
  build your own trees). On the hosted browser build it also points to the purely local
  `npx genograph` version with a copy-to-clipboard command; that tip is hidden in the
  local app. A `?` help button in the header reopens it any time. Fully translated (EN/TR)
  and theme-aware; shown once per browser (tracked in `localStorage`).
- **Run it in your browser — no install.** A free, static build hosted on GitHub Pages
  (<https://genograph.github.io/>) with the same UI as the local app. Your
  data still stays on your machine: real `.json` files in a folder you pick via the File
  System Access API (Chromium — with `.backups/` and `.trash/`, just like the local app),
  or your browser's own local database (IndexedDB) on other browsers and before a folder
  is chosen. The page makes no network requests after it loads; **Export JSON** is the
  backup/portability path for browser storage.
- **One storage interface, three auto-detected backends** (local server, picked folder,
  IndexedDB). The persistence layer was factored out of the UI into shared modules under
  `public/lib/` (`treeStore`, `storage`, `serverStore`, `fsStore`, `idbStore`) reused by
  the Node store, so id/slug rules and the tree shape stay identical everywhere.
- `.github/workflows/pages.yml` builds and deploys the static site (only `public/` plus the
  bundled example — never your `trees/`).
- **Custom data folder from the app.** The tree menu now surfaces where your trees
  are saved and lets you change it — point the app at an existing folder of trees,
  or move your current trees into a new one (e.g. your Desktop). The choice is
  remembered across launches in `~/.genograph/config.json`.
- `GET`/`PUT /api/settings` endpoint backing the data-folder picker.
- `GENOGRAPH_DATA` / `--data` now pin the folder for a single run and take
  priority over the remembered choice (the in-app picker is disabled while pinned).

## [1.0.0] - 2026-06-28

First public release.

### Added
- Offline family-tree browser & editor with a local-only HTTP server.
- **Multi-tree library:** create, open, rename, duplicate, delete, import and
  export (JSON) any number of family trees.
- Per-person editing: name, sex, dates (with *approximate* flags), places &
  countries, occupation, burial place, maiden name, aliases, cause of death,
  and free-text interview notes.
- Three views (Whole Family / Close Family / Ancestors), search, focus/re-root,
  pan & zoom, dark mode, and an English/Turkish interface toggle.
- Automatic backups before every save (kept per tree).
- Bundled example tree: the immediate relatives of Guy de Lusignan.
- `npx genograph`, global install, Homebrew formula and double-click launchers.

### Security
- Server binds to `127.0.0.1` only and rejects non-local `Host`/`Origin` requests
  (defends against DNS-rebinding / CSRF from other sites).
- Strict path handling for static files and tree storage.
- Strict Content-Security-Policy; no external resources or network calls.

[1.0.0]: https://github.com/genograph/genograph.github.io/releases/tag/v1.0.0
