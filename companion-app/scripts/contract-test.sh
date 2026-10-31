#!/usr/bin/env bash
# The companion app's API client against a real hub: build the hub image from this repo, run
# it on a private Docker network with a scratch database, then run HubContractTest in the
# companion build container pointed at it. Everything is torn down afterwards.
#
#   npm run companion:contract
#
# The hub gets an explicit, minimal environment — never the repo's .env — so ANTHROPIC_API_KEY
# can't reach it: commands use the free rules parser and this stays safe for regression and CI.
# The test itself also fails if the hub reports that it would use the model.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export MSYS_NO_PATHCONV=1
host_path() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

NET="hub-companion-contract"
HUB="hub-companion-contract-hub"
IMAGE="logger:companion-contract"

cleanup() {
  docker rm -f "$HUB" > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "==> Building the hub image..."
docker build -q -t "$IMAGE" "$(host_path "$repo")" > /dev/null

echo "==> Starting the hub (no Anthropic key, auth off, scratch database)..."
docker network create "$NET" > /dev/null
docker run -d --name "$HUB" --network "$NET" \
  -e PORT=3000 -e AUTH_ENABLED=false -e ANTHROPIC_API_KEY= -e DB_PATH=/tmp/contract.db \
  "$IMAGE" > /dev/null

for _ in $(seq 1 60); do
  if docker exec "$HUB" wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$HUB" wget -qO- http://localhost:3000/api/health > /dev/null || {
  echo "The hub didn't come up:"; docker logs "$HUB"; exit 1;
}

echo "==> Running HubContractTest against it..."
COMPANION_DOCKER_ARGS="--network $NET -e HUB_URL=http://$HUB:3000" \
  bash "$here/run.sh" testDebugUnitTest --tests "uk.aaronhanna.hub.companion.HubContractTest"
