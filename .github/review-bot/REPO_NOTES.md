# Repo notes - IG Plus

Facts the review bot cannot infer from one pass over the diff.

## The stack

A Manifest V3 browser extension with no bundler, framework, or runtime dependency. `src/` ships as
it is. Node is only development tooling: tests, lint, and the build script that rewrites the
manifest for each browser.

- `src/mobile.js`, `src/audience.js`, `src/camera.js`: main-world content scripts. They share the
  page's globals with Instagram's own code, so they wrap `fetch`, `XMLHttpRequest`, and input
  clicks, and must leave those working for Instagram when the extension has nothing to do.
- `src/bridge.js`, `src/hide.js`: isolated-world content scripts, which can reach extension APIs.
- `src/background.js`: a service worker on Chrome and an event page on Firefox.

Read `AGENTS.md` and `README.md` before reviewing. The README describes the intended behavior.

## What CI already covers, so never mention it

oxfmt, oxlint, markdownlint, `web-ext lint` on the Firefox build, actionlint, shellcheck, commitlint,
and the `node:test` suites. Formatting, lint rules and commit message shape are not your findings.

## What CI cannot cover, so it is yours

- **Instagram's private API.** Fields added to `configure_to_story` and uploads are undocumented.
  Check that a failure stops the share or reports it, never silently posting to a wider audience
  than the user chose. Close friends must fail closed.
- **Secrets in requests.** Request bodies carry session tokens such as `fb_dtsg`. Logging or
  reporting a body, header, or cookie is a blocking finding.
- **Main-world safety.** A wrapper that throws, or changes a request it was not asked to change,
  breaks Instagram for every user of the extension.
- **Both browsers.** Chrome and Firefox differ in background scripts, `identity`, and media
  recording. A change that only works in one should say so.
- **Permissions.** New `permissions` or `host_permissions` need a reason in the PR.
