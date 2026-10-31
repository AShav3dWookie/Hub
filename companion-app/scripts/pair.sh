#!/usr/bin/env bash
# npm run companion:pair — create a device token on the hub and hand it to the app on the phone.
#
# Settings, from the environment or .env:
#   COMPANION_HUB_URL       required: the address the PHONE will use, e.g. http://192.168.1.4:3000
#                           (this machine calls it too, so not localhost)
#   COMPANION_HUB_PASSWORD  the hub's login password, if it has auth on
#   COMPANION_DEVICE_NAME   what Settings > Devices calls it (default: the phone's model)
#   COMPANION_ADB_DEVICE    as for companion:install, when the phone is on wireless debugging
#
# The app is opened with a hubcompanion://pair link and asks "Pair with this hub?" before it
# changes anything; tap Pair and it saves and runs Test connection.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env COMPANION_HUB_URL COMPANION_HUB_PASSWORD COMPANION_DEVICE_NAME COMPANION_ADB_DEVICE
need_adb
command -v curl > /dev/null || die "curl isn't on your PATH."

hub="${COMPANION_HUB_URL:-}"
hub="${hub%/}"
[ -n "$hub" ] || die "set COMPANION_HUB_URL to the hub address the phone will use, e.g. http://192.168.1.4:3000"
[[ "$hub" =~ ^https?://[^[:space:]\&\#\?]+$ ]] || die "COMPANION_HUB_URL doesn't look like an address: $hub"
case "$hub" in *://localhost*|*://127.*) die "COMPANION_HUB_URL must be an address the phone can reach — use this machine's LAN IP, not localhost.";; esac

if [ -n "${COMPANION_ADB_DEVICE:-}" ]; then
  adb connect "$COMPANION_ADB_DEVICE" > /dev/null
  export ANDROID_SERIAL="$COMPANION_ADB_DEVICE"
fi
adb get-state > /dev/null 2>&1 || die "adb can't see a phone (see README.md \"Installing\")."
adb shell pm path uk.aaronhanna.hub.companion | grep -q package: || die "the app isn't on the phone — run npm run companion:install first."

name="${COMPANION_DEVICE_NAME:-$(adb shell getprop ro.product.model | tr -d '\r')}"
# curl is a native .exe under Git Bash, so both files get native paths — even /dev/null won't
# work for it there, which is why responses land in a file rather than being thrown away.
cookies="$(native_path "$(mktemp)")"
response="$(native_path "$(mktemp)")"
trap 'rm -f "$cookies" "$response"' EXIT
json_string() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }

# hub_post PATH JSON — POST with the session cookie; prints the HTTP status, body to $response.
hub_post() {
  curl -s -o "$response" -w '%{http_code}' -b "$cookies" -c "$cookies" \
    -H 'Content-Type: application/json' --data-binary @- "$hub$1" <<< "$2" \
    || die "couldn't reach the hub at $hub."
}

if [ -n "${COMPANION_HUB_PASSWORD:-}" ]; then
  status="$(hub_post /api/auth/login "{\"password\":$(json_string "$COMPANION_HUB_PASSWORD")}")"
  [ "$status" = "200" ] || die "the hub refused COMPANION_HUB_PASSWORD (HTTP $status)."
fi

status="$(hub_post /api/device-tokens "{\"name\":$(json_string "$name")}")"
case "$status" in
  201) ;;
  401) die "the hub has auth on — set COMPANION_HUB_PASSWORD." ;;
  *) die "the hub answered HTTP $status creating the device token." ;;
esac
token="$(sed -n 's/.*"token":"\(hub_[A-Za-z0-9_-]*\)".*/\1/p' "$response")"
[ -n "$token" ] || die "the hub's answer had no token in it."

echo "==> Created device \"$name\" on $hub. Opening the app..."
# Quoted for the phone's shell, where & would otherwise end the command.
adb shell "am start -a android.intent.action.VIEW -d 'hubcompanion://pair?url=$hub&token=$token' uk.aaronhanna.hub.companion" > /dev/null
echo "==> Tap Pair on the phone. It then tests the connection itself."
