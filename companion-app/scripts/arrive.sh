#!/usr/bin/env bash
# npm run companion:arrive -- "<list name>" — make the phone believe it's standing in that
# list's shop, to try "Are you at …?" without leaving the house.
#
# Looks the shop up on the hub, opens the app's Shops screen (which re-reads the lists and
# watches every tagged shop), then feeds the phone a fake position through adb: well away
# first, then inside the shop for long enough to count as a visit. Real GPS is back when it
# ends, Ctrl-C included.
#
# Settings, from the environment or .env:
#   COMPANION_HUB_URL, COMPANION_HUB_PASSWORD, COMPANION_ADB_DEVICE   as for companion:pair
#   COMPANION_ARRIVE_SECONDS   how long to stay in the shop (default 180: the app waits a
#                              minute, and Android's geofencing can take a while on top)
#
# A shop asks at most once an hour, so a second run inside the hour stays quiet by design.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env COMPANION_HUB_URL COMPANION_HUB_PASSWORD COMPANION_ADB_DEVICE COMPANION_ARRIVE_SECONDS
need_adb
command -v node > /dev/null || die "node isn't on your PATH (it reads the hub's answer)."

wanted="${1:-}"
[ -n "$wanted" ] || die "say which shop: npm run companion:arrive -- \"Sainsbury's\""
stay="${COMPANION_ARRIVE_SECONDS:-180}"
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
  if (l.itemCount === 0) console.error("note: " + l.name + " is empty, and an empty list doesn'\''t ask.");
  console.log([l.id, l.location.latitude, l.location.longitude, l.location.radiusM, l.name].join(" "));
' "$hub_response" "$wanted")" || exit 1 # node said why
read -r _ lat lng radius name <<< "$shop"

connect_phone
adb shell pm path uk.aaronhanna.hub.companion | grep -q package: || die "the app isn't on the phone — run npm run companion:install first."

providers=(gps network fused)
restore_gps() {
  echo "==> Handing location back to the real GPS."
  for p in "${providers[@]}"; do adb shell cmd location providers remove-test-provider "$p" > /dev/null 2>&1 || true; done
  adb shell appops set com.android.shell android:mock_location default > /dev/null 2>&1 || true
}
trap 'restore_gps; rm -f "$hub_cookies" "$hub_response"' EXIT
trap 'exit 130' INT TERM

echo "==> Opening Shops on the phone, so it's watching $name..."
adb shell am start -a android.intent.action.VIEW -d hubcompanion://shops uk.aaronhanna.hub.companion > /dev/null
sleep 5

adb shell appops set com.android.shell android:mock_location allow
for p in "${providers[@]}"; do
  adb shell cmd location providers add-test-provider "$p" > /dev/null 2>&1 || true
  adb shell cmd location providers set-test-provider-enabled "$p" true
done

# feed SECONDS LAT LNG — keep reporting one position, as a real fix would keep arriving.
feed() {
  local until=$((SECONDS + $1)) p
  while [ "$SECONDS" -lt "$until" ]; do
    for p in "${providers[@]}"; do
      adb shell cmd location providers set-test-provider-location "$p" --location "$2,$3" --accuracy 5
    done
    sleep 2
  done
}

# About 2 km north: outside any sensible radius, so going in is a real arrival.
away="$(node -e 'console.log((+process.argv[1] + 0.018).toFixed(6))' "$lat")"
echo "==> Somewhere else for 20 s..."
feed 20 "$away" "$lng"
echo "==> In $name ($lat, $lng; ${radius} m) for ${stay} s. \"Are you at $name?\" should appear after about a minute."
feed "$stay" "$lat" "$lng"
echo "==> Done."
