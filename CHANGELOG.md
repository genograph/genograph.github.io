# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Custom data folder from the app.** The tree menu now surfaces where your trees
  are saved and lets you change it — point the app at an existing folder of trees,
  or move your current trees into a new one (e.g. your Desktop). The choice is
  remembered across launches in `~/.famaile-tree/config.json`.
- `GET`/`PUT /api/settings` endpoint backing the data-folder picker.
- `FAMAILE_TREE_DATA` / `--data` now pin the folder for a single run and take
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
- `npx famaile-tree`, global install, Homebrew formula and double-click launchers.

### Security
- Server binds to `127.0.0.1` only and rejects non-local `Host`/`Origin` requests
  (defends against DNS-rebinding / CSRF from other sites).
- Strict path handling for static files and tree storage.
- Strict Content-Security-Policy; no external resources or network calls.

[1.0.0]: https://github.com/metemorris/famaile-tree/releases/tag/v1.0.0
