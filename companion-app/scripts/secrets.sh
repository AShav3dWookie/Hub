#!/usr/bin/env bash
# npm run companion:secrets — give GitHub Actions the release key, so a tagged release builds
# the signed APK and attaches it to the GitHub release (release.yml, job companion-apk).
#
# Reads the same settings as companion:build and sets four repository secrets with the GitHub
# CLI (`gh`, signed in to an account that can administer the repo). Values go to gh on stdin,
# never on a command line. Safe to re-run: it overwrites.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_signing_env

command -v gh > /dev/null || die "the GitHub CLI (gh) isn't on your PATH: https://cli.github.com"
[ -f "$COMPANION_KEYSTORE" ] || die "no key at $COMPANION_KEYSTORE — run npm run companion:keygen first."
[ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ] || die "set COMPANION_KEYSTORE_PASSWORD (in the environment or .env)."

cd "$repo"
base64 -w0 "$COMPANION_KEYSTORE" | gh secret set COMPANION_KEYSTORE_BASE64
printf '%s' "$COMPANION_KEYSTORE_PASSWORD" | gh secret set COMPANION_KEYSTORE_PASSWORD
printf '%s' "$COMPANION_KEY_ALIAS" | gh secret set COMPANION_KEY_ALIAS
printf '%s' "$COMPANION_KEY_PASSWORD" | gh secret set COMPANION_KEY_PASSWORD
echo "==> Set the four COMPANION_* Actions secrets. The next release will attach a signed APK."
