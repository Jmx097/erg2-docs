#!/usr/bin/env bash
set -euo pipefail

RELAY_BASE_URL="${RELAY_BASE_URL:?RELAY_BASE_URL is required}"
ADMIN_API_TOKEN="${ADMIN_API_TOKEN:?ADMIN_API_TOKEN is required}"

echo "Checking /v1/health"
curl --fail --silent "${RELAY_BASE_URL}/v1/health" >/dev/null

echo "Checking /v1/ready"
curl --fail --silent "${RELAY_BASE_URL}/v1/ready" >/dev/null

echo "Creating pairing session"
PAIRING_RESPONSE="$(
  curl --fail --silent \
    -H "authorization: Bearer ${ADMIN_API_TOKEN}" \
    -H "content-type: application/json" \
    -d '{"platform":"ios","device_display_name_hint":"Smoke Test iPhone"}' \
    "${RELAY_BASE_URL}/v1/pairing/sessions"
)"

echo "${PAIRING_RESPONSE}"
echo "Smoke test passed. Continue with the manual websocket, prompt, revoke, and restart checks from the checklist doc."
