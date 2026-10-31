#!/usr/bin/env bash
# npm run companion:build — build the APK in its container, into companion-app/dist/.
#
# Signed release APK when the release keystore exists (npm run companion:keygen makes it) and
# COMPANION_KEYSTORE_PASSWORD is set; otherwise a debug APK, which can't update a release
# install (or the other way round). Settings: README.md "Settings".
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
source "$here/lib.sh"
load_signing_env

if [ -f "$COMPANION_KEYSTORE" ] && [ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ]; then
  variant=release
else
  variant=debug
  echo "==> No release key ($COMPANION_KEYSTORE with COMPANION_KEYSTORE_PASSWORD): building a DEBUG APK."
fi

bash "$here/run.sh" "assemble${variant^}"

mkdir -p "$app/dist"
out="$app/dist/hub-companion-$(repo_version)-$variant.apk"
cp "$app/app/build/outputs/apk/$variant/app-$variant.apk" "$out"
echo "==> $out"
