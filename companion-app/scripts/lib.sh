#!/usr/bin/env bash
# Shared by the companion-app scripts. Sourced, not run.
#
# Every setting is an environment variable, and anything not set in the environment is read
# from the repo-root .env (the same file docker compose and `npm run voice:check` use). The
# .env is parsed, never `source`d: compose values there contain `$$`, which a shell would expand.
#
# Works from Git Bash and WSL2.

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$repo/companion-app"
IMAGE="hub-companion-builder"

# Git Bash rewrites anything that looks like /a/path in arguments; docker needs them as written.
export MSYS_NO_PATHCONV=1

die() { echo "error: $*" >&2; exit 1; }

# A host directory as docker on this machine wants it (C:/… under Git Bash, /… under WSL2).
host_path() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

# A path as bash wants it, whether given as C:\… (from Windows) or /c/… or /home/….
unix_path() { cygpath -u "$1" 2>/dev/null || echo "$1"; }

# A file path for a native program — curl and adb are Windows .exes under Git Bash, and with
# MSYS_NO_PATHCONV set nothing translates /tmp/… or /c/… for them. C:/… there; as-is on WSL2.
native_path() { cygpath -m "$1" 2>/dev/null || echo "$1"; }

# load_env VAR… — for each VAR not already set, take its value from the repo-root .env.
load_env() {
  local var value
  for var in "$@"; do
    [ -n "${!var:-}" ] && continue
    [ -f "$repo/.env" ] || continue
    # `|| true`: no match is normal, and must not trip the callers' `set -e -o pipefail`.
    value="$({ grep -E "^[[:space:]]*${var}=" "$repo/.env" || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r')"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    [ -n "$value" ] && export "$var=$value"
  done
  return 0
}

# The signing settings, with their defaults. See README.md "Signing".
load_signing_env() {
  load_env COMPANION_KEYSTORE COMPANION_KEYSTORE_PASSWORD COMPANION_KEY_ALIAS COMPANION_KEY_PASSWORD
  export COMPANION_KEYSTORE="$(unix_path "${COMPANION_KEYSTORE:-$HOME/.hub-companion/release.jks}")"
  export COMPANION_KEY_ALIAS="${COMPANION_KEY_ALIAS:-hub-companion}"
  # keytool uses the store password for the key unless told otherwise.
  if [ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ]; then
    export COMPANION_KEY_PASSWORD="${COMPANION_KEY_PASSWORD:-$COMPANION_KEYSTORE_PASSWORD}"
  fi
}

# The repo's version — the APK carries the same one (app/build.gradle.kts reads this file).
repo_version() { grep -m1 '"version"' "$repo/package.json" | cut -d'"' -f4; }

# Build the builder image if it's missing or docker/Dockerfile changed (its hash is a label).
ensure_image() {
  local want have
  want="$(sha256sum "$app/docker/Dockerfile" | cut -c1-16)"
  have="$(docker image inspect "$IMAGE" --format '{{ index .Config.Labels "dockerfile-hash" }}' 2>/dev/null || true)"
  if [ "$want" != "$have" ]; then
    echo "==> Building the $IMAGE image (first run, or the Dockerfile changed)..."
    docker build --label "dockerfile-hash=$want" -t "$IMAGE" "$(host_path "$app/docker")"
  fi
}

# adb from the PATH (Android platform-tools). Installing goes over USB or wireless debugging,
# neither of which a container on Docker Desktop can reach, so this one tool is the host's.
need_adb() {
  command -v adb > /dev/null || die "adb isn't on your PATH. Install Android platform-tools: https://developer.android.com/tools/releases/platform-tools"
}
