# Contributing to Genograph

Thanks for your interest! Genograph is a small, deliberately simple project:
a local Node.js server plus a vanilla-JS browser app, with **zero runtime
dependencies**. Please keep it that way — new runtime dependencies will generally
not be accepted.

## Getting started

```bash
git clone https://github.com/genograph/genograph.github.io.git
cd genograph.github.io
npm start     # runs at http://localhost:3456
npm test      # runs the test suite
```

You need Node.js 18+. There is no build step.

## Project layout

```
bin/genograph.js      CLI entry point (arg parsing, browser launch)
src/server.js         Local HTTP server + JSON API
src/store.js          Tree file storage (safe paths, atomic writes, backups)
public/index.html     App shell
public/style.css      Styles (light + dark)
public/app.js         Browser UI (ES module)
public/lib/model.js   Pure data logic (parse, migrate, normalize, serialize)
public/lib/layout.js  Pure tree layout algorithm
examples/lusignan.json  Bundled example tree
test/                 node:test suites
```

The modules in `public/lib/` are **pure** (no DOM, no globals) so they can be
unit-tested under Node and reused in the browser. Keep new logic testable: put
data/algorithm code in `lib/` with tests, and keep DOM code in `app.js`.

## Guidelines

- **No runtime dependencies.** Dev-only tooling is fine to discuss in an issue first.
- **Add or update tests** for any logic change (`npm test` must pass).
- **Keep it secure.** The server is local-only; preserve the loopback binding,
  `Host`/`Origin` checks, path-safety guards, and CSP.
- **Match the existing style** — 2-space indent, semicolons, small functions,
  comments only where intent isn't obvious.
- **Privacy first.** Never add analytics, telemetry, or any outbound network call.

## Reporting bugs

Open an issue with steps to reproduce, your OS and Node version, and (if relevant)
a small anonymized snippet of a tree JSON that triggers the problem. **Never paste
real personal data** about living people.

## License

By contributing you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
