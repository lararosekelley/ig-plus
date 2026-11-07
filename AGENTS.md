# IG Plus

A Manifest V3 browser extension for Instagram on Chrome, Firefox, and Firefox for Android. There is
no bundler: `src/` is loaded as it is, and `scripts/build.mjs` only rewrites the manifest per browser.

## Layout

- `src/`: the extension. `mobile.js`, `audience.js` and `camera.js` run in the page's main world;
  `bridge.js` and `hide.js` run in the isolated world; `background.js` is the service worker, or the
  event page on Firefox.
- `tests/`: `node:test` suites that run the scripts in `node:vm` against stubbed browser APIs.
- `scripts/`: the build, the per-browser manifests, and the release scripts.

## Checks

- `npm test` runs the unit tests.
- `npm run lint` runs oxfmt, oxlint, markdownlint, Mozilla's `web-ext lint`, actionlint, and
  shellcheck.
- Instagram itself cannot be tested in CI. Say what was tried in a real browser and what was not.

## Conventions

- Commits use `type(scope): description` with a scope from `commitlint.config.cjs`.
- Plain ASCII in prose, comments and commit messages: no em dashes, smart quotes or emoji.
- Comments explain a non-obvious constraint in a sentence or two.
- Requests the extension makes or amends must never log request bodies: they carry session tokens.
