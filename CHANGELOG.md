# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
