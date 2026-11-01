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

hub_setup
connect_phone
adb shell pm path uk.aaronhanna.hub.companion | grep -q package: || die "the app isn't on the phone — run npm run companion:install first."

name="${COMPANION_DEVICE_NAME:-$(adb shell getprop ro.product.model | tr -d '\r')}"
status="$(hub_call POST /api/device-tokens "{\"name\":$(json_string "$name")}")"
case "$status" in
  201) ;;
  401) die "the hub has auth on — set COMPANION_HUB_PASSWORD." ;;
  *) die "the hub answered HTTP $status creating the device token." ;;
esac
token="$(sed -n 's/.*"token":"\(hub_[A-Za-z0-9_-]*\)".*/\1/p' "$hub_response")"
[ -n "$token" ] || die "the hub's answer had no token in it."

echo "==> Created device \"$name\" on $hub. Opening the app..."
# Quoted for the phone's shell, where & would otherwise end the command.
adb shell "am start -a android.intent.action.VIEW -d 'hubcompanion://pair?url=$hub&token=$token' uk.aaronhanna.hub.companion" > /dev/null
echo "==> Tap Pair on the phone. It then tests the connection itself."
