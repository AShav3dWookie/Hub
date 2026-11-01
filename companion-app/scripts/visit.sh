#!/usr/bin/env bash
# Fake a shop visit with adb, to try the companion app's shop notifications without leaving the
# house:
#   npm run companion:arrive -- "<list name>"   standing in the shop: "Are you at …?"
#   npm run companion:leave -- "<list name>"    gone from it: the leave reminder, if you said Yes
#                                               at that shop within the last three hours
#
# Feeds the phone a fake position (in the shop, or well outside it), then has the app watch that
# shop afresh: the tag is cleared on the hub and put back exactly as it was, with the app's Shops
# screen opened after each so it drops the geofence and adds it again. A geofence added with the
# phone inside reports arriving after a minute; added with it outside, it reports leaving.
#
# Why not fake walking in or out? Found on a Pixel 6: Play Services reliably notices a faked
# position against a geofence it has just been given, but not a faked crossing of one it already
# has — so a second run would never fire. Real movement has no such problem; a walk to a real
# shop is the test of that.
#
# Real GPS and the tag are both back when it ends, Ctrl-C included.
#
# Settings, from the environment or .env:
#   COMPANION_HUB_URL, COMPANION_HUB_PASSWORD, COMPANION_ADB_DEVICE   as for companion:pair
#   COMPANION_ARRIVE_SECONDS   how long to stay at the fake position (default 120 for arrive: the
#                              app waits a minute, plus Play Services' own latency; 60 for leave)
#
# A shop asks at most once an hour, and each visit reminds once, so a repeat run stays quiet by
# design.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env COMPANION_HUB_URL COMPANION_HUB_PASSWORD COMPANION_ADB_DEVICE COMPANION_ARRIVE_SECONDS
need_adb
command -v node > /dev/null || die "node isn't on your PATH (it reads the hub's answer)."

mode="${1:-}"
case "$mode" in
  arrive) default_stay=120 ;;
  leave) default_stay=60 ;;
  *) die "visit.sh arrive|leave \"<list name>\" — use npm run companion:arrive or companion:leave." ;;
esac
wanted="${2:-}"
[ -n "$wanted" ] || die "say which shop: npm run companion:$mode -- \"Sainsbury's\""
stay="${COMPANION_ARRIVE_SECONDS:-$default_stay}"
[[ "$stay" =~ ^[0-9]+$ ]] || die "COMPANION_ARRIVE_SECONDS must be a number of seconds."

hub_setup
status="$(hub_call GET /api/lists)"
case "$status" in
  200) ;;
  401) die "the hub has auth on — set COMPANION_HUB_PASSWORD." ;;
  *) die "the hub answered HTTP $status listing the lists." ;;
esac

# "id latitude longitude radius name" for the one list that matches — the exact name (any
# case) first, else the only one containing it.
shop="$(node -e '
  const lists = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const want = process.argv[2].toLowerCase();
  let found = lists.filter((l) => l.name.toLowerCase() === want);
  if (found.length === 0) found = lists.filter((l) => l.name.toLowerCase().includes(want));
  if (found.length !== 1) {
    console.error(found.length ? "error: more than one list matches: " + found.map((l) => l.name).join(", ")
      : "error: no list matches. The lists are: " + lists.map((l) => l.name).join(", "));
    process.exit(1);
  }
  const l = found[0];
  if (!l.location) { console.error("error: " + l.name + " isn'\''t tagged to a shop yet — tag it from the app'\''s Shops screen."); process.exit(1); }
  if (l.itemCount === 0) console.error("note: " + l.name + " is empty, and an empty list stays quiet.");
  console.log([l.id, l.location.latitude, l.location.longitude, l.location.radiusM, l.name].join(" "));
' "$hub_response" "$wanted")" || exit 1 # node said why
read -r id lat lng radius name <<< "$shop"

# Where to stand: the shop itself, or due north of it, 500 m beyond its edge.
if [ "$mode" = arrive ]; then
  at_lat="$lat"
else
  at_lat="$(awk -v lat="$lat" -v r="$radius" 'BEGIN { printf "%.6f", lat + (r + 500) / 111320 }')"
fi

connect_phone
adb shell pm path uk.aaronhanna.hub.companion | grep -q package: || die "the app isn't on the phone — run npm run companion:install first."

providers=(gps network fused)
location="{\"latitude\":$lat,\"longitude\":$lng,\"radiusM\":$radius}"
tag_cleared=0

# set_tag JSON — the list's location on the hub, or null.
set_tag() {
  local status
  status="$(hub_call PATCH "/api/lists/$id" "{\"location\":$1}")"
  [ "$status" = "200" ] || die "the hub answered HTTP $status changing $name's tag."
}
open_shops() {
  # Its stderr is only "delivered to currently running top-most instance" on the second open,
  # which is the point: the open Shops screen re-reads the lists.
  adb shell am start -a android.intent.action.VIEW -d hubcompanion://shops uk.aaronhanna.hub.companion > /dev/null 2>&1
}
finish() {
  echo "==> Handing location back to the real GPS."
  for p in "${providers[@]}"; do adb shell cmd location providers remove-test-provider "$p" > /dev/null 2>&1 || true; done
  adb shell appops set com.android.shell android:mock_location default > /dev/null 2>&1 || true
  if [ "$tag_cleared" = 1 ]; then
    echo "==> Putting $name's tag back."
    # Not set_tag: its die would end the cleanup here.
    [ "$(hub_call PATCH "/api/lists/$id" "{\"location\":$location}")" = "200" ] \
      || echo "error: couldn't put the tag back — tag $name again from the app's Shops screen." >&2
    open_shops || true
  fi
  rm -f "$hub_cookies" "$hub_response"
}
trap finish EXIT
trap 'exit 130' INT TERM

adb shell appops set com.android.shell android:mock_location allow
for p in "${providers[@]}"; do
  adb shell cmd location providers add-test-provider "$p" > /dev/null 2>&1 || true
  adb shell cmd location providers set-test-provider-enabled "$p" true
done

# feed SECONDS — keep reporting the fake position, as real fixes would keep arriving.
feed() {
  local until=$((SECONDS + $1)) p
  while [ "$SECONDS" -lt "$until" ]; do
    for p in "${providers[@]}"; do
      adb shell cmd location providers set-test-provider-location "$p" --location "$at_lat,$lng" --accuracy 5
    done
    sleep 2
  done
}

if [ "$mode" = arrive ]; then
  echo "==> In $name ($lat, $lng; ${radius} m). Having the phone forget the shop..."
else
  echo "==> Outside $name, $((radius + 500)) m north of it. Having the phone forget the shop..."
fi
feed 3
tag_cleared=1
set_tag null
open_shops
feed 10

if [ "$mode" = arrive ]; then
  echo "==> ...and watch it again, for ${stay} s. \"Are you at $name?\" should appear after about a minute."
else
  echo "==> ...and watch it again, for ${stay} s. \"You left $name\" should appear within a minute,"
  echo "    if the phone said Yes at $name in the last three hours and the list isn't empty."
fi
set_tag "$location"
tag_cleared=0
open_shops
feed "$stay"
echo "==> Done."
