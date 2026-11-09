#!/usr/bin/env bash
# npm run companion:contract — the app's API client against a real hub: build the hub image
# from this repo, run it on a private Docker network with a scratch database, then run
# HubContractTest in the companion build container pointed at it. Torn down afterwards.
#
# The hub gets an explicit, minimal environment — never the repo's .env — so the real
# ANTHROPIC_API_KEY can't reach it. Its model is scripts/fakeVoiceModel.mjs, run from the same
# image as a second container, with a fake key: voice goes through the real model code, costs
# nothing, and stays safe for regression and CI.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
source "$here/lib.sh"

NET="hub-companion-contract"
HUB="hub-companion-contract-hub"
MODEL="hub-companion-contract-model"
HUB_IMAGE="logger:companion-contract"

cleanup() {
  docker rm -f "$HUB" "$MODEL" > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "==> Building the hub image..."
docker build -q -t "$HUB_IMAGE" "$(host_path "$repo")" > /dev/null

echo "==> Starting the hub (fake model, auth off, scratch database)..."
docker network create "$NET" > /dev/null
docker run -d --name "$MODEL" --network "$NET" -v "$(host_path "$repo/scripts"):/fake:ro" \
  "$HUB_IMAGE" node /fake/fakeVoiceModel.mjs 8787 > /dev/null
docker run -d --name "$HUB" --network "$NET" \
  -e PORT=3000 -e AUTH_ENABLED=false -e DB_PATH=/tmp/contract.db \
  -e ANTHROPIC_API_KEY=contract-fake-key -e "ANTHROPIC_BASE_URL=http://$MODEL:8787" \
  "$HUB_IMAGE" > /dev/null

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
