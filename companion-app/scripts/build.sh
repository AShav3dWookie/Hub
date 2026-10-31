#!/usr/bin/env bash
# Build the companion app's APK in its container and put it in companion-app/dist/.
#
#   npm run companion:build
#
# With the COMPANION_KEYSTORE* variables set (README.md "Signing") this is the signed release
# APK, the same as CI attaches to a GitHub release. Without them it is a debug APK: fine for a
# first try, but signed with a different key, so it can't update a release install (or the
# other way round) — Android would make you uninstall first, losing the pairing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/.." && pwd)"
# The repo's version, which the APK carries too (app/build.gradle.kts reads the same file).
version="$(grep -m1 '"version"' "$app/../package.json" | cut -d'"' -f4)"

if [ -n "${COMPANION_KEYSTORE:-}" ]; then
  variant=release
  task=assembleRelease
else
  variant=debug
  task=assembleDebug
  echo "==> No COMPANION_KEYSTORE set: building a DEBUG APK (see README.md \"Signing\")."
fi

bash "$here/run.sh" "$task"

mkdir -p "$app/dist"
out="$app/dist/hub-companion-$version-$variant.apk"
cp "$app/app/build/outputs/apk/$variant/app-$variant.apk" "$out"
echo "==> $out"
