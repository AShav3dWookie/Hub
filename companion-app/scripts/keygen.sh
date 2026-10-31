#!/usr/bin/env bash
# npm run companion:keygen — create the app's release signing key, once.
#
# Needs COMPANION_KEYSTORE_PASSWORD (environment or .env). Writes COMPANION_KEYSTORE (default
# ~/.hub-companion/release.jks) with alias COMPANION_KEY_ALIAS (default hub-companion). Runs
# keytool in the build container, so no JDK is needed here. Refuses to replace an existing key:
# a new key can't update the app that's installed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_signing_env

[ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ] || die "set COMPANION_KEYSTORE_PASSWORD (in the environment or .env) first."
[ "${#COMPANION_KEYSTORE_PASSWORD}" -ge 6 ] || die "COMPANION_KEYSTORE_PASSWORD must be at least 6 characters (keytool's rule)."
[ -e "$COMPANION_KEYSTORE" ] && die "$COMPANION_KEYSTORE already exists. Keep using it — a new key can't update the installed app."

ensure_image
mkdir -p "$(dirname "$COMPANION_KEYSTORE")"

# Passwords go in as environment variables (keytool's :env form), never on a command line.
docker run --rm \
  -v "$(host_path "$(dirname "$COMPANION_KEYSTORE")"):/keys" \
  -e COMPANION_KEYSTORE_PASSWORD -e COMPANION_KEY_PASSWORD \
  "$IMAGE" keytool -genkeypair -noprompt \
    -keystore "/keys/$(basename "$COMPANION_KEYSTORE")" -alias "$COMPANION_KEY_ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Hub companion" \
    -storepass:env COMPANION_KEYSTORE_PASSWORD -keypass:env COMPANION_KEY_PASSWORD

echo "==> Created $COMPANION_KEYSTORE"
echo "    Back it up together with COMPANION_KEYSTORE_PASSWORD. Lose either and future"
echo "    releases can't update the app on your phone. Next: npm run companion:install"
