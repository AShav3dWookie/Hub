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

# Stop unless adb has exactly one phone it's allowed to use, saying which fix applies.
require_phone() {
  local state
  state="$(adb get-state 2>&1 || true)"
  case "$state" in
    device) ;;
    *unauthorized*) die "the phone hasn't allowed this computer yet. Unlock it and tap Allow on \"Allow USB debugging?\" (tick \"Always allow from this computer\"). No prompt? Unplug and replug the cable; if it still doesn't appear, Developer options > Revoke USB debugging authorizations, then replug." ;;
    *"more than one"*) die "adb sees more than one device — set COMPANION_ADB_DEVICE to the one to use (adb devices lists them)." ;;
    *offline*) die "the phone shows as offline to adb — unplug and replug it (or toggle wireless debugging)." ;;
    *) die "adb can't see a phone. Plug it in with USB debugging on, or set COMPANION_ADB_DEVICE for wireless debugging (README.md \"Getting it onto the phone\")." ;;
  esac
}

# Reach the phone: over wireless debugging when COMPANION_ADB_DEVICE is set, else whichever
# single phone adb already sees. Stops with the fix when there isn't exactly one.
connect_phone() {
  if [ -n "${COMPANION_ADB_DEVICE:-}" ]; then
    adb connect "$COMPANION_ADB_DEVICE" | grep -q "connected" || die "adb couldn't connect to $COMPANION_ADB_DEVICE (is wireless debugging on, and the port current?)."
    export ANDROID_SERIAL="$COMPANION_ADB_DEVICE"
  fi
  require_phone
}

# Talking to the hub from this machine with curl, as the web app does. hub_setup reads
# COMPANION_HUB_URL (the address the PHONE uses — so a LAN IP, never localhost) and logs in when
# COMPANION_HUB_PASSWORD is set. The caller must load_env both first.
#
# curl is a native .exe under Git Bash, so its files get native paths — even /dev/null won't
# work for it there, which is why responses land in a file rather than being thrown away.
hub_setup() {
  command -v curl > /dev/null || die "curl isn't on your PATH."
  hub="${COMPANION_HUB_URL:-}"
  hub="${hub%/}"
  [ -n "$hub" ] || die "set COMPANION_HUB_URL to the hub address the phone will use, e.g. http://192.168.1.4:3000"
  [[ "$hub" =~ ^https?://[^[:space:]\&\#\?]+$ ]] || die "COMPANION_HUB_URL doesn't look like an address: $hub"
  case "$hub" in *://localhost*|*://127.*) die "COMPANION_HUB_URL must be an address the phone can reach — use this machine's LAN IP, not localhost.";; esac

  hub_cookies="$(native_path "$(mktemp)")"
  hub_response="$(native_path "$(mktemp)")"
  trap 'rm -f "$hub_cookies" "$hub_response"' EXIT

  if [ -n "${COMPANION_HUB_PASSWORD:-}" ]; then
    local status
    status="$(hub_call POST /api/auth/login "{\"password\":$(json_string "$COMPANION_HUB_PASSWORD")}")"
    [ "$status" = "200" ] || die "the hub refused COMPANION_HUB_PASSWORD (HTTP $status)."
  fi
}

# hub_call METHOD PATH [JSON] — prints the HTTP status; the body is left in $hub_response.
hub_call() {
  local args=(-s -o "$hub_response" -w '%{http_code}' -b "$hub_cookies" -c "$hub_cookies" -X "$1")
  if [ $# -ge 3 ]; then
    curl "${args[@]}" -H 'Content-Type: application/json' --data-binary @- "$hub$2" <<< "$3" \
      || die "couldn't reach the hub at $hub."
  else
    curl "${args[@]}" "$hub$2" || die "couldn't reach the hub at $hub."
  fi
}

json_string() { printf '%s' "$1" | sed 's/\/\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
