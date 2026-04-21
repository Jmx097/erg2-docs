# OpenClaw Mobile Companion for Even Realities G2

This repo now tracks the production-minded mobile companion path for Even
Realities G2 on a single VPS. The React Native mobile companion is the primary
production client, and the bridge is the production backend base.

The canonical implementation brief for what this project is actually building now
lives in [docs/openclaw-mobile-companion-architecture.md](docs/openclaw-mobile-companion-architecture.md).

## Current Repo State

- `bridge/` is the production backend base: pairing, auth, websocket relay,
  revocation, readiness, structured logs, Postgres migrations, and cleanup.
- `mobile/` is the React Native-oriented production client scaffold with BLE,
  secure storage, auth/session, websocket lifecycle, and repair modules.
- `glasses/` is still an Even Hub prototype for simulator and diagnostic use.
  It is not the shipped production client.

Important:

- Do not treat `VITE_G2_BRIDGE_TOKEN` or `G2_BRIDGE_TOKEN` as production client auth.
- Do not expose OpenClaw directly to mobile or glasses clients.
- Production architecture uses one-time pairing, short-lived Ed25519-signed
  access tokens, rotating refresh tokens, single-use websocket tickets, and a
  VPS relay in front of localhost-bound services.

## Layout

- `bridge/` - Node/TypeScript relay and auth service
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

Mobile workspace:

```bash
cp mobile/.env.example mobile/.env
npm run dev:mobile
```

The current mobile app is an Expo shell with mocked BLE by default. It is meant
to exercise real pairing, restore, refresh, websocket, and repair flows against
the bridge while the native G2 BLE implementation is still pending.

## Deployment

Use the repo-owned assets under `ops/`:

- `ops/env/bridge.production.env.example`
- `ops/nginx/openclaw-mobile.conf`
- `ops/systemd/*.service`
- `ops/scripts/*.sh`

Before promoting a build, follow
[docs/staging-promotion-checklist.md](docs/staging-promotion-checklist.md).
