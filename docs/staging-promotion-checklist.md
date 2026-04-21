# Staging To Production Checklist

## Preflight

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run test:integration`
- `npm run build`
- Confirm `ops/env/bridge.production.env.example` values are populated in the real environment.
- Confirm nginx only exposes `80/443` and the bridge, OpenClaw, and Postgres are localhost-bound.

## Smoke Checks

- `GET /v1/health` succeeds through nginx.
- `GET /v1/ready` returns `200` with `storage=postgres` and both checks healthy.
- Create a pairing session with the operator token.
- Redeem the pairing session with the mobile flow using `pairing_session_id` plus `pairing_code`.
- Register a new mobile device and confirm access plus refresh tokens are returned.
- Refresh the session and confirm the refresh token rotates.
- Request a websocket ticket and connect to `/v1/relay/ws`.
- Send `hello`, receive `ready`, then send a `prompt` and confirm `reply.delta` plus `reply.final`.
- Revoke the device and confirm the websocket receives `revoked` and closes with the revoke code.

## Failure Recovery

- Restart the bridge service and confirm the mobile client reconnects with a new websocket ticket.
- Temporarily stop the OpenClaw upstream and confirm `/v1/ready` fails closed.
- Restore OpenClaw and confirm `/v1/ready` returns healthy again.
- Trigger a Postgres backup with `ops/scripts/backup-postgres.sh`.
- Restore the latest backup into staging before any production promotion.

## Sign-Off

- Journal logs show structured JSON for requests, relay lifecycle, cleanup, and upstream calls.
- Secrets were generated from fresh material and not copied from development.
- Access-token key rotation and Postgres restore steps were rehearsed on staging.
