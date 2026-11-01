#!/usr/bin/env bash
# npm run companion:install — build the signed APK and install it on the phone (or update it).
#
# The phone is reached with adb, over USB (USB debugging on, cable plugged in) or wireless
# debugging (README.md "Installing"). Optional settings, from the environment or .env:
#   COMPANION_ADB_DEVICE     ip:port shown under Developer options > Wireless debugging; connects first
#   COMPANION_ADB_PAIR       ip:port from "Pair device with pairing code" — first time only,
#   COMPANION_ADB_PAIR_CODE  with the six-digit code; pass these two on the command line
# With neither, adb uses whichever single phone it can already see.
#
# Only installs a signed release build: a debug build is signed with a different key, so
# swapping between the two means uninstalling and losing the pairing.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
source "$here/lib.sh"
load_signing_env
load_env COMPANION_ADB_DEVICE COMPANION_ADB_PAIR COMPANION_ADB_PAIR_CODE
need_adb

[ -f "$COMPANION_KEYSTORE" ] || die "no release key at $COMPANION_KEYSTORE — run npm run companion:keygen first."
[ -n "${COMPANION_KEYSTORE_PASSWORD:-}" ] || die "set COMPANION_KEYSTORE_PASSWORD (in the environment or .env)."

if [ -n "${COMPANION_ADB_PAIR:-}" ]; then
  [ -n "${COMPANION_ADB_PAIR_CODE:-}" ] || die "COMPANION_ADB_PAIR needs COMPANION_ADB_PAIR_CODE (the six-digit code on the phone)."
  adb pair "$COMPANION_ADB_PAIR" "$COMPANION_ADB_PAIR_CODE"
fi
if [ -n "${COMPANION_ADB_DEVICE:-}" ]; then
  adb connect "$COMPANION_ADB_DEVICE" | grep -q "connected" || die "adb couldn't connect to $COMPANION_ADB_DEVICE (is wireless debugging on, and the port current?)."
  export ANDROID_SERIAL="$COMPANION_ADB_DEVICE"
fi
require_phone

bash "$here/build.sh"
apk="$app/dist/hub-companion-$(repo_version)-release.apk"
[ -f "$apk" ] || die "the build didn't produce $apk"

echo "==> Installing on $(adb shell getprop ro.product.model | tr -d '\r')..."
adb install -r "$(native_path "$apk")"

# Android 17+ blocks an app from the home network (a hub at 192.168.x.x) until it holds this
# runtime permission. The app asks for it at pairing; granting it here saves the prompt.
if [ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 37 ]; then
  adb shell pm grant uk.aaronhanna.hub.companion android.permission.ACCESS_LOCAL_NETWORK \
    && echo "==> Granted local network access (Android 17+)."
fi
echo "==> Installed. Next: npm run companion:pair"
