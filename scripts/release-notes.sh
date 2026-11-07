#!/usr/bin/env bash
#
# Prints one version's notes from CHANGELOG.md, without its heading, for a
# GitHub release.
#
#   scripts/release-notes.sh 1.1.1

set -euo pipefail

version="${1:?usage: release-notes.sh VERSION}"
notes="$(awk -v v="$version" '
  /^## / { if (found) exit; if ($2 == v) { found = 1; next } }
  found { print }
' "$(dirname "$0")/../CHANGELOG.md")"
if [ -z "${notes//[$'\n ']/}" ]; then
  echo "release-notes.sh: CHANGELOG.md has no notes for $version" >&2
  exit 1
fi
printf '%s\n' "$notes"
