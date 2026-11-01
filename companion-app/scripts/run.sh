#!/usr/bin/env bash
# Run Gradle for the companion app inside its build container.
#
#   bash companion-app/scripts/run.sh testDebugUnitTest    # what `npm run companion:test` does
#
# The other companion scripts call this. Gradle's and Robolectric's downloads live in named
# volumes, so only the first run is slow. When the release keystore exists (see lib.sh's
# load_signing_env and README.md "Signing") it is mounted read-only and release builds are
# signed with it.
#
# COMPANION_DOCKER_ARGS adds docker run options (the contract test uses it to join the hub's
# network).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ensure_image
load_signing_env

args=(--rm
  -v "$(host_path "$repo"):/repo"
  -v hub-companion-gradle:/cache/gradle
  -v hub-companion-m2:/root/.m2)

if [ -f "$COMPANION_KEYSTORE" ] && [ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ]; then
  args+=(-v "$(host_path "$(dirname "$COMPANION_KEYSTORE")")/$(basename "$COMPANION_KEYSTORE"):/keystore/release.jks:ro"
    -e COMPANION_KEYSTORE=/keystore/release.jks
    -e COMPANION_KEYSTORE_PASSWORD -e COMPANION_KEY_ALIAS -e COMPANION_KEY_PASSWORD)
fi

# shellcheck disable=SC2086 # COMPANION_DOCKER_ARGS is deliberately word-split
docker run "${args[@]}" ${COMPANION_DOCKER_ARGS:-} "$IMAGE" gradle --no-daemon --console=plain "$@"
