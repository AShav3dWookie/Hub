#!/usr/bin/env bash
# Run Gradle for the companion app inside its build container.
#
#   bash companion-app/scripts/run.sh testDebugUnitTest    # unit + Robolectric tests
#   bash companion-app/scripts/run.sh assembleRelease      # the APK (see "Signing" below)
#
# Builds the image the first time (or when docker/Dockerfile changes). Gradle's and
# Robolectric's downloads live in named volumes, so only the first run is slow.
#
# Signing: a release build is signed when these are set (see companion-app/README.md):
#   COMPANION_KEYSTORE           path to the .jks on this machine (mounted read-only)
#   COMPANION_KEYSTORE_PASSWORD  COMPANION_KEY_ALIAS  COMPANION_KEY_PASSWORD
# Without them a release build comes out unsigned, which a phone will refuse to install.
#
# Extra docker run options can be passed in COMPANION_DOCKER_ARGS (the contract test uses it to
# join the hub container's network).
set -euo pipefail

IMAGE="hub-companion-builder"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

# Git Bash on Windows rewrites anything that looks like a /path; docker needs them as written.
export MSYS_NO_PATHCONV=1
host_path() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

# Rebuild the image only when its Dockerfile changed (the hash is stored as a label).
dockerfile="$repo/companion-app/docker/Dockerfile"
want="$(sha256sum "$dockerfile" | cut -c1-16)"
have="$(docker image inspect "$IMAGE" --format '{{ index .Config.Labels "dockerfile-hash" }}' 2>/dev/null || true)"
if [ "$want" != "$have" ]; then
  echo "==> Building the $IMAGE image (first run, or the Dockerfile changed)..."
  docker build --label "dockerfile-hash=$want" -t "$IMAGE" "$(host_path "$repo/companion-app/docker")"
fi

args=(--rm
  -v "$(host_path "$repo"):/repo"
  -v hub-companion-gradle:/cache/gradle
  -v hub-companion-m2:/root/.m2)

if [ -n "${COMPANION_KEYSTORE:-}" ]; then
  keystore_dir="$(host_path "$(dirname "$COMPANION_KEYSTORE")")"
  args+=(-v "$keystore_dir/$(basename "$COMPANION_KEYSTORE"):/keystore/release.jks:ro"
    -e COMPANION_KEYSTORE=/keystore/release.jks
    -e COMPANION_KEYSTORE_PASSWORD -e COMPANION_KEY_ALIAS -e COMPANION_KEY_PASSWORD)
fi

# shellcheck disable=SC2086 # COMPANION_DOCKER_ARGS is deliberately word-split
docker run "${args[@]}" ${COMPANION_DOCKER_ARGS:-} "$IMAGE" gradle --no-daemon --console=plain "$@"
