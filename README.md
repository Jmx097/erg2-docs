# OpenClaw Mobile Companion for Even Realities G2

This repo now tracks the production-minded mobile companion path for Even
Realities G2 on a single VPS. The React Native mobile companion is the primary
production client, the VPS bridge is the production backend base, and the
laptop bridge is the thin local hardware adapter for BLE-only deployments.

The canonical implementation brief for what this project is actually building now
lives in [docs/openclaw-mobile-companion-architecture.md](docs/openclaw-mobile-companion-architecture.md).

## Current Repo State

- `bridge/` is the production backend base: pairing, auth, websocket relay,
  revocation, readiness, structured logs, Postgres migrations, and cleanup.
- `laptop-bridge/` is the local Node/TypeScript BLE hardware bridge for laptop
  Bluetooth access and upstream forwarding to the VPS.
- `mobile/` is the React Native-oriented production client with native BLE
  adapter wiring, secure storage, auth/session, websocket lifecycle, and repair
  modules.
- `glasses/` is a thin Even Hub `.ehpk` client for Even Realities G2. It
  prefers HTTP `/v1/turn` with paired device credentials and can optionally use
  the legacy authenticated `/v0/turn` path for compatibility.

## Status

Implemented in code:

- bridge pairing, registration, refresh rotation, websocket tickets, relay,
  revoke, readiness, and cleanup flows are implemented
- mobile pairing, restore, refresh, reconnect, repair, and websocket flows are
  implemented
- mobile BLE now uses a real native adapter path via `react-native-ble-plx`
  instead of the old no-op bridge
- local Postgres-backed integration has a repo-owned Docker runner
- laptop bridge mock mode, health endpoint, upstream transport, and VPS ingest
  contract are implemented

Validated locally:

- repo-wide `typecheck`, `test`, and `build` are green
- `npm run test:integration:local` now fails fast with a clear Docker Desktop
  prerequisite message when the local Docker engine is unavailable

Validated on staging:

- not yet exercised from this workspace

Still blocked by external runtime or hardware:

- Docker Desktop or another reachable Postgres instance is still required to run
  the actual Postgres-backed integration suite end to end
- staging deployment, nginx validation, smoke checks, backup/restore rehearsal,
  and key-rotation rehearsal still need to be executed against a real host
- G2-specific BLE service and characteristic UUIDs still need to be supplied in
  environment config for real device message I/O
- real laptop-side BLE transport implementation beyond the current G2 adapter
  stub still needs to be completed once hardware constants are known

Important:

- Do not treat `VITE_G2_BRIDGE_TOKEN` or `G2_BRIDGE_TOKEN` as production client auth.
- Do not expose OpenClaw directly to mobile or glasses clients.
- Production architecture uses one-time pairing, short-lived Ed25519-signed
  access tokens, rotating refresh tokens, single-use websocket tickets, and a
  VPS relay in front of localhost-bound services.

## Layout

- `bridge/` - Node/TypeScript relay and auth service
- `laptop-bridge/` - thin local BLE-to-VPS bridge for laptop hardware access
- `mobile/` - production mobile companion scaffold
- `glasses/` - prototype Even Hub simulator app
- `ops/` - nginx, systemd, env templates, and operations scripts
- `docs/openclaw-mobile-companion-architecture.md` - canonical product and
  systems architecture brief
- `docs/staging-promotion-checklist.md` - staging to production promotion checks
- `AI-OS-Build-Plan.md` - legacy background note and source list

## Verification

Run the shared verification suite:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Postgres-backed integration coverage is available when `TEST_DATABASE_URL` is set:

```bash
npm run test:integration
```

For the standard local path on Windows or any machine using Docker Desktop:

```bash
npm run test:integration:local
```

This runner assumes:

- Docker Desktop is running
- local container name: `openclaw-test-postgres`
- local port: `54329`
- database: `openclaw_test`
- credentials: `openclaw` / `openclaw`
- `TEST_DATABASE_URL=postgres://openclaw:openclaw@127.0.0.1:54329/openclaw_test`

You can also manage the container explicitly:

```powershell
npm run local:postgres:up
npm run test:integration
npm run local:postgres:down
```

## Local Development

Bridge:

```bash
cp bridge/.env.example bridge/.env
npm run dev:bridge
```

Glasses prototype:

```bash
cp glasses/.env.example glasses/.env
npm run dev:glasses
```

Even Hub package build:

```bash
npm run build -w glasses
npm run pack -w glasses
```

The package artifact is written to `glasses/openclaw-g2.ehpk`.

Mobile workspace:

```bash
cp mobile/.env.example mobile/.env
npm run dev:mobile
```

Laptop bridge workspace:

```bash
cp laptop-bridge/.env.example laptop-bridge/.env
npm run dev:laptop-bridge
```

The current mobile app is an Expo-based native client. It is meant to exercise
real pairing, restore, refresh, websocket, repair, and native BLE connectivity
against the bridge.

Bridge production assumptions are:

- `BRIDGE_STORE_DRIVER=postgres`
- Postgres is reachable and migrations can run
- OpenClaw remains localhost-bound
- `/v1/ready` only passes when both Postgres and OpenClaw are healthy
- `HARDWARE_BRIDGE_TOKEN` is set separately for the laptop bridge ingest path

## Even Hub `.ehpk` Path

The `glasses/` workspace is the repo-owned Even Hub client path for G2:

- default transport: paired `POST /v1/turn` over HTTPS with rotated access and
  refresh credentials stored in Even Hub local storage
- compatibility fallback: authenticated `GET /health` and `POST /v0/turn` when
  a legacy bridge token is configured locally
- no OpenClaw terminal mode and no direct client access to localhost-bound
  OpenClaw
- no long-lived websocket requirement for the HUD client

Build, package, and verify:

```bash
npm run typecheck -w glasses
npm run test -w glasses
npm run build -w glasses
npm run pack -w glasses
```

Local config:

```bash
cp glasses/.env.example glasses/.env
```

Supported `glasses/.env` defaults:

- `VITE_DEFAULT_RELAY_BASE_URL`
- `VITE_DEFAULT_DEVICE_DISPLAY_NAME`
- `VITE_DEFAULT_LEGACY_BRIDGE_TOKEN`
- `VITE_DEFAULT_PROMPT_DRAFT`

Use on device:

1. Install `glasses/openclaw-g2.ehpk` in Even Hub.
2. Open the app once to let it create its durable local `installId`.
3. For the preferred v1 flow, enter the relay URL, pairing code, and device
   display name, then pair.
4. For legacy compatibility only, leave pairing empty and provide relay URL plus
   legacy bridge token.
5. Single-click sends the saved prompt over HTTP. Double-click cancels or
   returns to idle. Foregrounding restores the session after WebView restarts.

For a real Ubuntu/Debian staging host, the repo now also includes:

- `ops/scripts/install-vps-assets.sh` to install env, nginx, and systemd assets
- `npm run staging:validate` for ordered host health/readiness/smoke checks
- `npm run staging:rehearsal` for restart, outage, backup, restore, and key rotation rehearsal

## Deployment

Use the repo-owned assets under `ops/`:

- `ops/env/bridge.production.env.example`
- `ops/nginx/openclaw-mobile.conf`
- `ops/systemd/*.service`
- `ops/scripts/*.sh`

Before promoting a build, follow
[docs/staging-promotion-checklist.md](docs/staging-promotion-checklist.md).
