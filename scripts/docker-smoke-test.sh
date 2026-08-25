#!/usr/bin/env bash
# Builds the Docker image, runs it, polls /api/health, then tears down.
# Used by `npm run docker:test`.
set -euo pipefail

IMAGE_TAG="logger:smoke-test"
CONTAINER_NAME="logger-smoke-test"
HOST_PORT="3099"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building image..."
docker build -t "$IMAGE_TAG" .

echo "==> Starting container..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER_NAME" -p "${HOST_PORT}:3000" "$IMAGE_TAG" >/dev/null

echo "==> Waiting for /api/health..."
ATTEMPTS=30
until curl -sf "http://localhost:${HOST_PORT}/api/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS - 1))
  if [ "$ATTEMPTS" -le 0 ]; then
    echo "Server did not become healthy in time." >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
  sleep 1
done

RESPONSE=$(curl -sf "http://localhost:${HOST_PORT}/api/health")
echo "==> Health check response: $RESPONSE"

if [ "$RESPONSE" != '{"status":"ok"}' ]; then
  echo "Unexpected health check response." >&2
  exit 1
fi

echo "==> Smoke test passed."
