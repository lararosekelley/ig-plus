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

## Store descriptions & screenshots

### Description

Paste as it is: the store keeps line breaks, so lines are not wrapped.

```text
A better web experience for Instagram!

Post Instagram stories from your computer, and use Instagram without the endless home page or Reels feeds.

POST STORIES FROM DESKTOP

Instagram only lets phones post stories. IG Plus opens Instagram in a phone-sized window that Instagram treats as a phone, so the Story button works. Your other Instagram tabs stay as they are.

- Take a photo with your webcam, choose a file, pick from Google Photos, or start from a solid or gradient background.
- Edit before posting: move and zoom the photo, add text in several styles, and draw.
- Share to Close Friends only.
- Discard a story you've started and go back to the feed.

FEWER DISTRACTIONS

- Hide home feed posts while keeping the stories tray.
- Hide the Reels tab. Reels people send you in messages still open.
  Turn either one on or off from the toolbar button.

PRIVACY

IG Plus has no servers and collects no data. Photos and settings stay in your browser. Google Photos sign-in only opens Google's photo picker.

IG Plus is not affiliated with or endorsed by Instagram or Meta. Instagram changes its site often, so features may stop working until IG Plus is updated.
```

### Privacy

The answers for the Privacy tab in the Chrome Web Store dashboard.

Single purpose:

> IG Plus improves Instagram on the web: it lets you post stories from a desktop browser, with an
> editor for photos, text and drawing, and it can hide the home feed and Reels.

Permission justifications:

- `declarativeNetRequest`: Instagram only offers story posting to phones. For the IG Plus phone
  window, and only for that tab, a session rule sends a mobile `User-Agent` and drops desktop client
  hint headers on requests to instagram.com. Other tabs and sites are not changed.
- `identity`: Signs in to Google so you can choose a photo or video from Google Photos for a story.
  It asks only for read access to the items you pick in Google's photo picker.
- `storage`: Saves your two settings, "Hide home feed posts" and "Hide Reels", in the browser.
- Host permissions:
  - `instagram.com`: Runs the story editor, the phone window and the feed and Reels hiding on
    Instagram, and applies the phone window's request rule.
  - `photospicker.googleapis.com`: Opens Google's photo picker and reads which items you picked.
  - `googleusercontent.com`: Downloads the photo or video you picked from Google Photos.

Remote code: No. Every script ships in the package. IG Plus fetches only data and media (Instagram
posts, Google Photos items), never code to run.

Data usage: IG Plus has no server and sends nothing to its developer. Photos, videos and text you
choose go only to Instagram, when you post them. The Google sign-in token stays in the browser and
is used only with Google Photos. Tick no data types, and certify the three statements (not sold, not
used for unrelated purposes, not used for creditworthiness).

Privacy policy URL: <https://github.com/lararosekelley/ig-plus/blob/main/PRIVACY.md>
