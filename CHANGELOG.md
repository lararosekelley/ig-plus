# Changelog

What changed in each version, for the people using the extension. Each section is drafted with
`git cliff` and then written up by hand; see [RELEASING.md](RELEASING.md). The release workflow
publishes the section matching the tag as the GitHub release notes, so headings must stay
`## X.Y.Z - YYYY-MM-DD`.

## 1.0.6 - 2026-11-11

### Changed

- IG Plus is now on [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/ig-plus/). Firefox and Firefox for
  Android installs and updates come from there.

## 1.0.4 - 2026-11-11

### Changed

- Firefox installs now get their updates from addons.mozilla.org instead of GitHub, ready for IG Plus's listing
  there.

## 1.0.3 - 2026-11-09

### Changed

- Firefox for Android no longer shows the Google Photos button, which could not sign in there. Use "Choose
  file" to pick a photo from the phone instead.

## 1.0.2 - 2026-11-09

### Added

- Share photo and video posts, including reels, to a story with the "Add to story" button beside Save
  in the home feed, or from a post's link with "Share post". The story links to the post. Videos
  play in the story with sound, for up to 60 seconds.
- Keep a story off Facebook with the new "Facebook" setting. Video stories always skip Facebook.
- Text starts as white on black, in joined boxes like Instagram's own.
- The editor dims the edges that phones taller than 9:16 cut off.
- The settings popup shows the version.
- Firefox installs update themselves from now on. Install this version by hand once.
- The Chrome download keeps one extension ID, so unzipping a new version over the old folder keeps
  your settings and Google Photos sign-in.

## 1.0.0 - 2026-11-04

The first release, signed for Firefox and Firefox for Android.

### Added

- Post stories from desktop through a phone window, starting from the webcam, a file, Google
  Photos, or a solid or gradient background.
- An editor for stories with zoom, text, and drawing.
- Share a story to close friends only.
- Hide home feed posts and Reels.
