#!/usr/bin/env bash
#
# Tags a release. Run on an up-to-date main whose src/manifest.json names the
# version and whose CHANGELOG.md already has the version's section at the top.
#
#   scripts/release.sh 1.2.0
#
# Pushing vX.Y.Z runs the release workflow, which signs and publishes it.

set -euo pipefail

version="${1:?usage: release.sh X.Y.Z}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

die() {
  echo "release.sh: $*" >&2
  exit 1
}

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z, got $version"
tag="v$version"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "must be on main"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "tracked changes are uncommitted"
git fetch --quiet --tags origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not in sync with origin/main"
! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || die "$tag already exists"

latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sed 's/^v//' | sort -V | tail -1)"
if [ -n "$latest" ] && [ "$(printf '%s\n%s\n' "$latest" "$version" | sort -V | tail -1)" != "$version" ]; then
  die "$version is not newer than $latest"
fi

manifest="$(node -p 'require("./src/manifest.json").version')"
[ "$manifest" = "$version" ] || die "src/manifest.json names $manifest, not $version"

top="$(sed -n 's/^## \([0-9][0-9.]*\) - .*/\1/p' CHANGELOG.md | head -1)"
[ "$top" = "$version" ] || die "CHANGELOG.md's newest section is $top, not $version"
notes="$(scripts/release-notes.sh "$version")"

echo "Release $tag at $(git log --oneline -1)."
echo
printf '%s\n\n' "$notes"
read -r -p "Tag and push? [y/N] " answer
[ "$answer" = y ] || die "nothing done"

git tag -a "$tag" -m "$tag"
git push origin "refs/tags/$tag"
echo "Pushed $tag. The release workflow signs and publishes it."
