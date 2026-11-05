#!/usr/bin/env bash
# npm run hub:logs -- [--since 24h] [--source voice] [--level warn] [--limit 200] [--json]
#
# Prints the hub's own log (docs/logs.md), newest last. Configured by environment variables,
# each falling back to the repo-root .env (parsed, never `source`d — it holds `$$` values):
#
#   HUB_LOGS_TOKEN  a logs token from Settings → Devices ("Logs only"). Required.
#   HUB_URL         the hub to ask. Default https://hub.aaronhanna.uk. /api/device/* passes
#                   Authelia, so this works from anywhere; a LAN address works too.
#
#   --since   30m, 2h, 3d or an ISO time (default 24h)
#   --source  server | http | voice | notifications
#   --level   info | warn | error — that level and worse
#   --limit   the newest N entries (default 200, max 5000)
#   --json    the raw JSON instead of one line per entry
#
# Works from Git Bash and WSL2.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { echo "error: $*" >&2; exit 1; }

# For each VAR not already set, take its value from the repo-root .env.
load_env() {
  local var value
  for var in "$@"; do
    [ -n "${!var:-}" ] && continue
    [ -f "$repo/.env" ] || continue
    value="$({ grep -E "^[[:space:]]*${var}=" "$repo/.env" || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r')"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    [ -n "$value" ] && export "$var=$value"
  done
  return 0
}

load_env HUB_URL HUB_LOGS_TOKEN
hub="${HUB_URL:-https://hub.aaronhanna.uk}"
hub="${hub%/}"
[ -n "${HUB_LOGS_TOKEN:-}" ] || die "set HUB_LOGS_TOKEN (Settings → Devices → \"Logs only: read from a PC\") in the environment or the repo-root .env."

since="24h" source="" level="" limit="" format="text"
while [ $# -gt 0 ]; do
  case "$1" in
    --since) since="${2:?--since needs a value}"; shift 2 ;;
    --source) source="${2:?--source needs a value}"; shift 2 ;;
    --level) level="${2:?--level needs a value}"; shift 2 ;;
    --limit) limit="${2:?--limit needs a value}"; shift 2 ;;
    --json) format="json"; shift ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done

args=(-G -sS --max-time 20 -H "Authorization: Bearer $HUB_LOGS_TOKEN"
  --data-urlencode "since=$since" --data-urlencode "format=$format")
[ -n "$source" ] && args+=(--data-urlencode "source=$source")
[ -n "$level" ] && args+=(--data-urlencode "level=$level")
[ -n "$limit" ] && args+=(--data-urlencode "limit=$limit")

# The status goes on a last line of its own, so the body never needs a temp file.
response="$(curl "${args[@]}" -w '\n%{http_code}' "$hub/api/device/logs")" || die "couldn't reach $hub"
status="${response##*$'\n'}"
body="${response%$'\n'*}"

case "$status" in
  200) [ -n "$body" ] && printf '%s\n' "$body" || echo "(no entries since $since)" >&2 ;;
  401) die "the hub refused HUB_LOGS_TOKEN — revoked or mistyped? Make a new one in Settings → Devices." ;;
  403) die "that's a phone token. Make a \"Logs only\" one in Settings → Devices." ;;
  404) die "$hub has no /api/device/logs — it's running a release from before logs; upgrade it." ;;
  302|303) die "$hub redirected to a login page. Is nginx's Authelia bypass for /api/(voice|device) in place?" ;;
  *) die "the hub answered HTTP $status: $body" ;;
esac
