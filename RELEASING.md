# Releasing

1. Draft the notes with `git cliff --unreleased --tag vX.Y.Z`, then write them up at the top of
   `CHANGELOG.md` under `## X.Y.Z - YYYY-MM-DD`, in words for the people using the extension.
2. Set `version` in `src/manifest.json` to `X.Y.Z`.
3. Merge both to `main`.
4. Run `npm run release -- X.Y.Z`. It checks that `main` is clean and in sync with `origin`, that the
   version is newer than the last release and matches the manifest, and that `CHANGELOG.md` has its
   section, then asks before it tags `vX.Y.Z` and pushes the tag.

Pushing `vX.Y.Z` runs the release workflow:

1. It tests and builds the extension.
2. AMO signs the Firefox build as an unlisted add-on. This can take a few minutes.
3. A GitHub release is published with the signed `.xpi`, the unpacked Chrome zip, and the
   `CHANGELOG.md` section as its notes. Its `updates.json` points signed Firefox copies at the new
   `.xpi`; they find it through the latest release, so do not mark a release as a pre-release.
4. Once the Chrome Web Store listing exists, the store's Chrome zip is uploaded and submitted for
   review.

## Settings it needs

Repository secrets:

- `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`: API keys from
  [AMO's developer hub](https://addons.mozilla.org/developers/addon/api/key/), for the account that
  first signed `ig-plus@larakelley.com`.
- `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN`: a Google OAuth client and refresh
  token for the Chrome Web Store API. See
  [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys).
- `CWS_EXTENSION_ID` and `CWS_PUBLISHER_ID`: the store item and publisher. Until
  `CWS_EXTENSION_ID` is set, releases skip the Chrome Web Store.
- `IG_PLUS_CHROME_CLIENT_ID`: the client ID, ending in `.apps.googleusercontent.com`, of a Chrome
  Extension OAuth client made for the store's item ID, so Google Photos works in the store build.
- `ANTHROPIC_API_KEY`: for the code review bot on pull requests.
