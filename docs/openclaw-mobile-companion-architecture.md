# OpenClaw Mobile Companion Architecture for Even Realities G2

Status: canonical implementation brief

This document is the source of truth for the product and systems architecture in
this repo.

## 1. Summary

Build a production-minded OpenClaw-powered mobile companion for Even Realities G2
glasses. The mobile app is the primary client. It talks to the glasses locally,
reaches OpenClaw services through one public VPS endpoint, and survives the messy
parts of real usage: expired tokens, relay restarts, app backgrounding, dropped
mobile networks, and reconnect storms.

For laptop-local Bluetooth access, the repo also supports a split architecture
where a nearby laptop runs a thin BLE bridge and forwards normalized device
events to the VPS-hosted bridge over an authenticated HTTPS interface.

The current `bridge/` and `glasses/` directories remain useful prototypes, but
they are not the target production architecture. In particular, production does
not rely on static bearer tokens pasted into a shipped client.

## 2. Reference Stack and Defaults

| Area | Decision |
| --- | --- |
| Mobile app | React Native |
| Local glasses link | Native BLE bridge inside the mobile app |
| Secure storage | iOS Keychain, Android Keystore-backed secure storage |
| Public API | `https://api.example.com` |
| Websocket endpoint | `wss://api.example.com/v1/relay/ws` |
| VPS service | Node.js + TypeScript + Hono |
| Persistence | Postgres |
| Reverse proxy | nginx |
| OpenClaw upstream | HTTP to localhost-bound OpenClaw |
| Access tokens | Short-lived signed JWTs |
| Refresh tokens | Opaque random tokens, rotated on every refresh |
| Websocket tickets | Opaque single-use tickets with 30 second TTL |

Recommended mobile libraries:

- BLE: `react-native-ble-plx`
- secure storage: `react-native-keychain`
- network reachability: `@react-native-community/netinfo`

## 3. Scope and Non-Goals

In scope:

- pairing and bootstrap
- device registration and identity
- short-lived access tokens
- rotating refresh tokens and token families
- websocket relay auth and lifecycle
- OpenClaw session brokering
- nginx and VPS hardening
- user-facing repair and recovery paths

Out of scope:

- BLE reverse engineering details
- the glasses protocol itself beyond the app-to-glasses boundary
- multi-user account management
- distributed multi-region relay infrastructure

## 4. Current Repo Alignment

Today the repo contains:

- `bridge/`: a substantial Node/Hono relay with pairing, registration, refresh
  rotation, websocket tickets, revocation, readiness, Postgres storage, and
  structured logging
- `mobile/`: a React Native mobile companion with secure storage, auth/session
  lifecycle, websocket reconnect logic, repair UI, and a native BLE adapter
  boundary using `react-native-ble-plx`
- `laptop-bridge/`: a local Node/TypeScript BLE bridge with mock mode, health
  endpoint, structured logs, normalized event forwarding, and an Xreal G2 BLE
  adapter stub awaiting final UUID and protocol constants
- `glasses/`: a thin Even Hub app that stores a durable local `installId`,
  persists relay config in Even Hub storage, prefers paired HTTP `POST /v1/turn`,
  and can optionally fall back to authenticated legacy `POST /v0/turn`

Treat those pieces as:

- `bridge/` and `mobile/` are the canonical implementation surfaces for auth,
  pairing, session identity, relay lifecycle, and production deployment
- `glasses/` is the repo-owned thin Even Hub client path for HUD rendering and
  HTTP prompt delivery through the bridge without relying on terminal mode
- local repo verification is green, but staging validation and recovery
  rehearsal still need to run against a real host
- remaining mobile gap: G2-specific BLE UUID/config finalization and hardware
  validation on a development build
- remaining laptop-bridge gap: real laptop-side BLE transport beyond the current
  adapter stub once Xreal G2 service and characteristic details are confirmed

## 5. Architecture Summary

Use one canonical public endpoint and keep stateful services on the droplet.

```text
Even G2 glasses
    ^
    | BLE
    v
React Native mobile companion
    |  HTTPS for control plane
    |  WSS for interactive relay
    v
nginx on VPS (TLS termination, websocket proxy, rate limits)
    |
    v
Node/TypeScript service on 127.0.0.1:8787
    |- pairing/bootstrap module
    |- auth/session module
    |- websocket relay module
    |- OpenClaw adapter
    |- audit logging
    v
Postgres on localhost/private network

Node relay -> OpenClaw on 127.0.0.1:18789
```

Operational defaults:

- nginx listens publicly on `80/443`
- Node service listens on `127.0.0.1:8787`
- OpenClaw listens on `127.0.0.1:18789`
- Postgres is not public
- mobile and glasses never call OpenClaw directly

## 6. Service Boundaries

### 6.1 Mobile companion

Responsibilities:

- pair against the VPS
- securely store `device_id`, refresh token, and last known relay URL
- refresh access tokens before they expire
- request single-use websocket tickets
- maintain websocket connection with heartbeat handling and reconnect backoff
- translate local glasses interactions into relay prompts
- show repair flows for revoked or expired credentials

The mobile app is the only user-facing production client that needs long-lived
credentials.

### 6.1.1 Even Hub thin client

Responsibilities:

- keep a durable local `installId` plus local relay config in Even Hub storage
- pair once against the VPS and store `device_id`, refresh token, and default
  conversation for the preferred v1 path
- send prompts over HTTP `POST /v1/turn` instead of maintaining a long-lived
  websocket
- optionally use authenticated legacy `GET /health` and `POST /v0/turn` when a
  bridge token is configured for compatibility with the existing bridge auth
- recover from WebView foreground/background churn by restoring config and
  reusing the stored device registration

Constraints:

- do not hardcode secrets in the package
- do not call OpenClaw directly from the client
- keep replies concise enough for HUD display

### 6.2 Pairing/bootstrap module

Responsibilities:

- mint short-lived pairing sessions from an operator-only flow
- issue QR payloads and human-entered pairing codes
- redeem pairing codes into single-use bootstrap tokens
- enforce code TTL, redemption limits, and brute-force protection

Important: `POST /v1/pairing/sessions` is operator-only. In MVP, the simplest
safe implementation is a local CLI or admin page protected by localhost access,
Tailscale, or Cloudflare Access. It is not a public anonymous endpoint.

### 6.3 Auth/session module

Responsibilities:

- register devices after bootstrap
- issue access tokens
- rotate refresh tokens
- detect refresh-token reuse across a family
- revoke devices and disconnect active sessions
- mint websocket connect tickets

### 6.4 Websocket relay module

Responsibilities:

- validate single-use websocket tickets
- dedupe active connections per `device_id`
- enforce ping/pong heartbeat
- forward prompts to OpenClaw
- stream replies back to the client
- emit auth, revoke, and connection-state events

### 6.5 OpenClaw adapter

Responsibilities:

- map device and conversation identity into `x-openclaw-session-key`
- call OpenClaw over localhost only
- normalize upstream errors into relay-safe error codes
- add request IDs for tracing across relay and OpenClaw

The recommended session key format is:

```text
mobile:<device_id>:conversation:<conversation_id>
```

Defaults:

- every device gets a `default` conversation at registration time
- future multi-thread support adds more `conversation_id` values without changing
  device identity

### 6.6 Persistence layer

Use Postgres for the canonical production design. SQLite is acceptable only for
local development experiments.

Postgres stores:

- paired devices
- pairing sessions
- refresh token families
- individual rotated refresh tokens
- revocation records
- connection events
- prompt idempotency records for reconnect safety

Ephemeral websocket tickets can live in process memory for MVP because the
reference deployment is a single relay process on one VPS. If the relay later
scales horizontally, move websocket ticket storage to Redis.

## 7. Authentication Model

### 7.1 Credential types

| Credential | Purpose | TTL | Notes |
| --- | --- | --- | --- |
| Pairing code | Human-entered or QR bootstrap secret | 10 minutes | Single-use, brute-force protected |
| Bootstrap token | Temporary credential after pairing redemption | 60 seconds | Single-use, only for device registration |
| Access token | API and websocket-ticket auth | 5 minutes | Signed JWT |
| Refresh token | Renewable device credential | 30 day sliding, 90 day absolute | Rotated every refresh |
| Websocket ticket | One-time websocket handshake | 30 seconds | Single-use, not reused after connect |

### 7.2 Device identity vs session identity

Device identity:

- `device_id` is long-lived
- it survives app restarts
- it is revocable independently of other devices

Session identity:

- access tokens represent a short-lived authenticated session for a device
- websocket connections are bound to a single device session
- OpenClaw conversation identity is separate again and uses `conversation_id`

This separation prevents the common failure mode where one leaked long-lived
bearer token becomes the device identity forever.

### 7.3 Token format choices

Access tokens:

- JWT signed with Ed25519
- claims: `iss`, `aud`, `sub`, `jti`, `exp`, `iat`, `nbf`, `device_id`, `scope`
- `sub` format: `device:<device_id>`
- `scope` values: `device:self`, `auth:refresh`, `relay:connect`, `relay:prompt`

Refresh tokens:

- 256-bit random opaque tokens
- store only `token_hash = HMAC_SHA256(server_secret, raw_token)` in Postgres
- one database record per issued refresh token
- every refresh consumes the old token and returns a new token in the same family

Websocket tickets:

- 256-bit random opaque values
- stored with `device_id`, `conversation_id`, `expires_at`, and `used_at`
- consume the ticket during the websocket handshake before accepting messages

Pairing codes:

- format: `XXXX-XXXX` using Crockford Base32
- stored as `Argon2id(code + per-row salt)`
- lock the pairing session after 10 failed attempts

### 7.4 Refresh token family rules

- each registered device gets one active refresh-token family
- a successful refresh:
  - marks the presented token as used and replaced
  - issues a new token in the same family
  - updates `last_used_at`
- if an already-used refresh token is presented again:
  - mark the family as `compromised`
  - revoke every outstanding refresh token in that family
  - close active websocket connections for that device
  - require explicit repair or re-pair

### 7.5 Secure storage on device

iOS:

- store `device_id`, refresh token, and last relay URL in Keychain
- use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`

Android:

- store the same values in Keystore-backed encrypted storage
- do not store tokens in plain SharedPreferences

The mobile app must never store access tokens longer than necessary. Access
tokens can stay in memory only and be recreated from refresh when needed.

## 8. Connection Lifecycle

### 8.1 First-time pairing

```text
1. Operator -> Pairing service: POST /v1/pairing/sessions
2. Pairing service -> Operator: pairing_code + qr_payload + expires_at
3. User -> Mobile app: scan QR or enter relay URL + pairing code
4. Mobile app -> Pairing service: POST /v1/pairing/redeem
5. Pairing service -> Mobile app: bootstrap_token (60s, single-use)
6. Mobile app -> Auth service: POST /v1/devices/register with bootstrap token
7. Auth service -> Mobile app: device_id + access_token + refresh_token
8. Mobile app -> Secure storage: persist device_id + refresh_token + relay URL
```

### 8.2 Normal connect

```text
1. Mobile app loads device_id + refresh token from secure storage
2. If access token missing or expiring soon, mobile app calls POST /v1/auth/refresh
3. Mobile app calls POST /v1/auth/ws-ticket with access token
4. Auth service returns single-use websocket ticket
5. Mobile app opens wss://api.example.com/v1/relay/ws?ticket=...
6. Relay validates and consumes ticket
7. Mobile app sends hello with conversation_id and client metadata
8. Relay responds ready with connection_id, heartbeat config, and token expiry
```

### 8.3 Token refresh during active use

```text
1. Mobile app tracks access token expiry in memory
2. When < 60 seconds remain, app refreshes in background
3. If refresh succeeds, future API calls use the new access token
4. Existing websocket stays up until reconnect is needed
5. If server sends token.expiring or closes with auth-related code, app refreshes and reconnects
```

### 8.4 App restart recovery

```text
1. App process restarts
2. App reads device_id + refresh token + relay URL from secure storage
3. App refreshes access token if needed
4. App requests a websocket ticket
5. App reconnects without re-pairing
6. App sends resume with conversation_id, last_event_id, and pending_prompt_id if any
```

### 8.5 VPS relay restart recovery

```text
1. Relay process restarts and all websocket connections drop
2. Mobile app treats close code as reconnectable
3. App waits using backoff + jitter
4. App refreshes if needed
5. App requests a new websocket ticket
6. App reconnects and sends resume
7. Relay replays final buffered reply if present, or returns prompt_interrupted for lost in-flight work
```

### 8.6 Device revocation

```text
1. Operator -> Auth service: POST /v1/devices/{deviceId}/revoke
2. Auth service marks device and token family revoked
3. Auth service emits revoked to active websocket connection if present
4. Relay closes the websocket with a revoke close code
5. Mobile app deletes local credentials and shows repair flow
```

### 8.7 Heartbeat and stale detection

Defaults:

- server sends websocket `ping` every 25 seconds
- client must answer `pong` within 10 seconds
- after 2 missed heartbeat windows, server closes the connection as stale
- client treats close as reconnectable unless the reason is revoked or invalid credentials

### 8.8 Reconnect policy

Defaults:

- exponential backoff with full jitter
- start at 1 second
- cap at 30 seconds
- reset backoff after 60 seconds of healthy connection
- one active websocket per device; the newest connection wins

Connection dedupe rule:

- when a new websocket connection is accepted for a device, the relay closes the
  older connection with code `4009` and reason `replaced_by_new_connection`

### 8.9 Mobile network switching

When the mobile network changes from Wi-Fi to cellular or vice versa:

- drop the old socket immediately if it is no longer healthy
- do not wait for the old path to time out naturally
- keep the same device identity and conversation ID
- acquire a fresh websocket ticket before reconnecting

### 8.10 Prompt idempotency and resume behavior

Every `prompt` message must include a client-generated `prompt_id`.

Rules:

- server stores `device_id + prompt_id`
- if the same prompt is retried after a reconnect, the server returns the known
  final result instead of duplicating work
- do not attempt byte-perfect mid-stream resume in MVP
- after relay restart, if a final result was not persisted, return
  `prompt_interrupted` and let the client retry with the same `prompt_id`

## 9. Public API Contracts

### 9.1 `POST /v1/pairing/sessions`

Purpose:

- mint a one-time pairing session for a new mobile device

Auth:

- operator-only

Request:

```json
{
  "platform": "ios",
  "device_display_name_hint": "Jon's iPhone"
}
```

Response:

```json
{
  "pairing_session_id": "ps_01JV8N9GM88Q6YCC8FX5MWA4Y1",
  "pairing_code": "F7KD-92QM",
  "relay_base_url": "https://api.example.com",
  "expires_at": "2026-04-20T22:10:00Z",
  "qr_payload": "openclaw://pair?relay=https%3A%2F%2Fapi.example.com&code=F7KD-92QM"
}
```

### 9.2 `POST /v1/pairing/redeem`

Purpose:

- exchange a valid pairing code for a single-use bootstrap token

Auth:

- anonymous, but heavily rate-limited

Request:

```json
{
  "pairing_code": "F7KD-92QM"
}
```

Response:

```json
{
  "bootstrap_token": "btp_3f8fca2f3b7f4b119d8b8df427e0f8f9",
  "bootstrap_expires_at": "2026-04-20T22:01:00Z",
  "pairing_session_id": "ps_01JV8N9GM88Q6YCC8FX5MWA4Y1"
}
```

### 9.3 `POST /v1/devices/register`

Purpose:

- register a mobile device after bootstrap

Auth:

- `Authorization: Bearer <bootstrap_token>`

Request:

```json
{
  "device_display_name": "Jon's iPhone",
  "platform": "ios",
  "app_version": "0.1.0",
  "conversation_id": "default"
}
```

Response:

```json
{
  "device_id": "dev_01JV8NAQ1VSX7B80W4TC6SV3QH",
  "access_token": "<jwt>",
  "access_expires_at": "2026-04-20T22:05:00Z",
  "refresh_token": "rt_7f0f5ad3f4ab4d5ea427f318b58fce31",
  "refresh_expires_at": "2026-05-20T22:00:00Z",
  "refresh_family_id": "rtf_01JV8NB7YYXWQ0G4B2X6V2XDFM",
  "default_conversation_id": "default"
}
```

### 9.4 `POST /v1/auth/refresh`

Purpose:

- rotate the refresh token and issue a fresh access token

Auth:

- anonymous request body plus refresh token, because the access token may be expired

Request:

```json
{
  "device_id": "dev_01JV8NAQ1VSX7B80W4TC6SV3QH",
  "refresh_token": "rt_7f0f5ad3f4ab4d5ea427f318b58fce31"
}
```

Response:

```json
{
  "access_token": "<jwt>",
  "access_expires_at": "2026-04-20T22:10:00Z",
  "refresh_token": "rt_b3cfc1457d4c4d15b8a1436f9f71f0d6",
  "refresh_expires_at": "2026-05-20T22:05:00Z",
  "refresh_family_id": "rtf_01JV8NB7YYXWQ0G4B2X6V2XDFM"
}
```

### 9.5 `POST /v1/auth/ws-ticket`

Purpose:

- obtain a single-use websocket handshake ticket

Auth:

- access token required

Request:

```json
{
  "conversation_id": "default"
}
```

Response:

```json
{
  "ticket": "wst_4e2e9f48f6d94c7b8bde98fef51f3a5b",
  "expires_at": "2026-04-20T22:05:30Z",
  "ws_url": "wss://api.example.com/v1/relay/ws?ticket=wst_4e2e9f48f6d94c7b8bde98fef51f3a5b"
}
```

### 9.6 `GET /v1/devices`

Purpose:

- list devices for operator review and revocation

Auth:

- operator-only

Response:

```json
{
  "devices": [
    {
      "device_id": "dev_01JV8NAQ1VSX7B80W4TC6SV3QH",
      "device_display_name": "Jon's iPhone",
      "platform": "ios",
      "status": "active",
      "last_seen_at": "2026-04-20T22:04:55Z"
    }
  ]
}
```

### 9.7 `POST /v1/devices/{deviceId}/revoke`

Purpose:

- revoke a single device without resetting global secrets

Auth:

- operator-only

Request:

```json
{
  "reason": "device_lost"
}
```

Response:

```json
{
  "device_id": "dev_01JV8NAQ1VSX7B80W4TC6SV3QH",
  "status": "revoked",
  "revoked_at": "2026-04-20T22:20:00Z",
  "disconnect_active_sessions": true
}
```

## 10. Websocket Protocol

Endpoint:

```text
wss://api.example.com/v1/relay/ws?ticket=<single-use-ticket>
```

Handshake rules:

- ticket must exist
- ticket must be unexpired
- ticket must be unused
- ticket is consumed before the relay accepts application messages

Client messages:

### `hello`

```json
{
  "type": "hello",
  "conversation_id": "default",
  "client_instance_id": "inst_01JV8NF2MFFCY7DHE5M0X4M7B7",
  "app_state": "foreground",
  "last_event_id": "evt_1024"
}
```

### `prompt`

```json
{
  "type": "prompt",
  "conversation_id": "default",
  "prompt_id": "prm_01JV8NG5E9JQW3H8PG9N2N8V5K",
  "text": "Summarize the last message for the G2 display"
}
```

### `pong`

```json
{
  "type": "pong",
  "ping_id": "png_01JV8NGR6Y1TJ8ZXNQFT8Y5X8K"
}
```

### `resume`

```json
{
  "type": "resume",
  "conversation_id": "default",
  "last_event_id": "evt_1028",
  "pending_prompt_id": "prm_01JV8NG5E9JQW3H8PG9N2N8V5K"
}
```

Server messages:

### `ready`

```json
{
  "type": "ready",
  "connection_id": "con_01JV8NHFQ9EHW9G7W3VK3ZK8R6",
  "heartbeat_interval_seconds": 25,
  "pong_timeout_seconds": 10,
  "access_token_expires_at": "2026-04-20T22:10:00Z"
}
```

### `reply.delta`

```json
{
  "type": "reply.delta",
  "event_id": "evt_1029",
  "prompt_id": "prm_01JV8NG5E9JQW3H8PG9N2N8V5K",
  "delta": "OpenClaw is online"
}
```

### `reply.final`

```json
{
  "type": "reply.final",
  "event_id": "evt_1030",
  "prompt_id": "prm_01JV8NG5E9JQW3H8PG9N2N8V5K",
  "text": "OpenClaw is online and the relay is healthy.",
  "request_id": "req_01JV8NHRMCHJ8KT7S8BQ08MF6K"
}
```

### `error`

```json
{
  "type": "error",
  "code": "prompt_interrupted",
  "message": "The relay restarted before the final reply was persisted.",
  "retryable": true,
  "prompt_id": "prm_01JV8NG5E9JQW3H8PG9N2N8V5K"
}
```

### `ping`

```json
{
  "type": "ping",
  "ping_id": "png_01JV8NGR6Y1TJ8ZXNQFT8Y5X8K"
}
```

### `token.expiring`

```json
{
  "type": "token.expiring",
  "expires_at": "2026-04-20T22:10:00Z"
}
```

### `revoked`

```json
{
  "type": "revoked",
  "reason": "device_lost"
}
```

Recommended websocket close codes:

| Code | Meaning |
| --- | --- |
| 4001 | invalid_ticket |
| 4003 | revoked |
| 4008 | auth_expired |
| 4009 | replaced_by_new_connection |
| 4010 | server_restart |

## 11. Persistence Model

### 11.1 `paired_devices`

| Column | Type | Notes |
| --- | --- | --- |
| `device_id` | text primary key | ULID or UUIDv7 |
| `device_display_name` | text | User-visible label |
| `platform` | text | `ios` or `android` |
| `status` | text | `active`, `revoked`, `repair_required` |
| `created_at` | timestamptz | |
| `last_seen_at` | timestamptz | |
| `last_ip` | inet | optional |
| `last_app_version` | text | optional |
| `current_refresh_family_id` | text | active family |

### 11.2 `pairing_sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `pairing_session_id` | text primary key | |
| `code_hash` | text | Argon2id hash |
| `status` | text | `pending`, `redeemed`, `expired`, `locked` |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | |
| `redeemed_at` | timestamptz | nullable |
| `failed_attempts` | integer | lock after 10 |
| `created_by` | text | operator identifier |

### 11.3 `refresh_token_families`

| Column | Type | Notes |
| --- | --- | --- |
| `refresh_family_id` | text primary key | |
| `device_id` | text | foreign key |
| `status` | text | `active`, `revoked`, `compromised` |
| `created_at` | timestamptz | |
| `compromised_at` | timestamptz | nullable |
| `revoke_reason` | text | nullable |

### 11.4 `refresh_tokens`

| Column | Type | Notes |
| --- | --- | --- |
| `refresh_token_id` | text primary key | |
| `refresh_family_id` | text | foreign key |
| `token_hash` | text | HMAC-SHA-256 |
| `parent_refresh_token_id` | text | nullable |
| `issued_at` | timestamptz | |
| `expires_at` | timestamptz | |
| `used_at` | timestamptz | nullable |
| `replaced_by_refresh_token_id` | text | nullable |
| `revoked_at` | timestamptz | nullable |

### 11.5 `revocations`

| Column | Type | Notes |
| --- | --- | --- |
| `revocation_id` | text primary key | |
| `subject_type` | text | `device`, `family`, `token` |
| `subject_id` | text | |
| `reason` | text | |
| `created_at` | timestamptz | |
| `created_by` | text | operator identifier |

### 11.6 `connection_events`

| Column | Type | Notes |
| --- | --- | --- |
| `connection_event_id` | text primary key | |
| `device_id` | text | foreign key |
| `connection_id` | text | |
| `event_type` | text | `connected`, `closed`, `stale`, `revoked`, `refresh_reuse_detected` |
| `occurred_at` | timestamptz | |
| `ip` | inet | optional |
| `network_type` | text | optional |
| `close_code` | integer | nullable |
| `details_json` | jsonb | optional metadata |

## 12. nginx and VPS Hardening

### 12.1 Required nginx behavior

- terminate TLS at nginx
- proxy websocket upgrades correctly
- keep long websocket timeouts
- rate-limit pairing, refresh, and connect endpoints
- preserve request IDs and forwarding headers

### 12.2 Sample nginx configuration

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

limit_req_zone $binary_remote_addr zone=pairing_limit:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=refresh_limit:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=connect_limit:10m rate=20r/m;

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Request-Id $request_id;

    location /v1/pairing/redeem {
        limit_req zone=pairing_limit burst=10 nodelay;
        proxy_pass http://127.0.0.1:8787;
    }

    location /v1/auth/refresh {
        limit_req zone=refresh_limit burst=20 nodelay;
        proxy_pass http://127.0.0.1:8787;
    }

    location /v1/auth/ws-ticket {
        limit_req zone=connect_limit burst=20 nodelay;
        proxy_pass http://127.0.0.1:8787;
    }

    location /v1/relay/ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
    }
}
```

### 12.3 Firewall posture

- open only `80` and `443` publicly
- restrict SSH to admin IPs where possible
- bind Node service to `127.0.0.1`
- bind OpenClaw to `127.0.0.1`
- do not publish Postgres to the internet

### 12.4 Logging and audit

Every request and connection should log:

- request ID
- device ID when known
- refresh family ID when known
- connection ID when known
- remote IP
- revoke reason when relevant

Do not log:

- raw refresh tokens
- raw access tokens
- raw bootstrap tokens
- full pairing codes

Safe logging pattern:

- log only the last 4 characters of pairing codes
- log only token IDs or hashes, never raw values

### 12.5 Service management

- run the Node service under `systemd`
- run OpenClaw under `systemd`
- configure restart-on-failure for both
- keep nginx reloadable without exposing localhost services

## 13. Threat Model and Mitigations

| Threat | Mitigation |
| --- | --- |
| Token leakage | Keep access tokens at 5 minutes, store refresh tokens only in secure storage, never log raw tokens |
| Replay attempts | Single-use pairing codes, single-use bootstrap tokens, single-use websocket tickets, refresh rotation with reuse detection |
| Brute-force pairing | Short code TTL, IP rate limits, session lockout after repeated failures, QR bootstrap when possible |
| Device theft | Per-device revocation, family revocation, secure storage, no long-lived static bearer in app config |
| Accidental user misconfiguration | Separate URL and pairing code fields, strict validation, targeted error messages |
| Exposed backend services | nginx public edge only, Node and OpenClaw localhost-bound, firewall restrictions |
| Stale long-lived bearer tokens | No permanent client bearer token model, short-lived JWT access tokens only |
| Reconnect storms | Exponential backoff with full jitter, per-device connect throttles, connection dedupe |

## 14. UX Safeguards

### 14.1 Input validation

Use separate fields:

- Relay URL
- Pairing code
- Device display name

Validation rules:

- relay URL must parse as `https://` or `wss://`
- pairing code must match `^[A-Z0-9]{4}-[A-Z0-9]{4}$`
- if the pairing code field looks like a URL, show:
  `This looks like a relay URL, not a pairing code. Paste it into the Relay URL field.`
- if the pairing code field looks like a JWT or long token, show:
  `This looks like a token. This app pairs with a short code or QR scan, not a pasted bearer token.`

### 14.2 Required user-facing errors

| State | User message | Repair action |
| --- | --- | --- |
| Expired pairing code | `That pairing code expired.` | Request a new code |
| Revoked device | `This device was revoked.` | Re-pair device |
| Wrong endpoint | `The relay URL did not respond like an OpenClaw relay.` | Edit relay URL |
| Relay unavailable | `Cannot reach the relay right now.` | Retry with backoff |
| Session expired and recovered | `Session refreshed.` | No action required |
| Session expired and refresh failed | `Session could not be refreshed.` | Reconnect or re-pair |

### 14.3 Repair flow

Present three distinct actions:

- `Reconnect`: retry websocket without clearing credentials
- `Refresh session`: force a refresh-token exchange
- `Re-pair device`: delete stored credentials and start the pairing flow again

## 15. Implementation Checklist

### 15.1 Backend

- expand the current `bridge/` direction into a localhost-bound Node service
- add pairing, auth, websocket relay, and OpenClaw adapter modules
- add Postgres schema for devices, pairing sessions, token families, tokens, revocations, and connection events
- add prompt idempotency storage
- add structured request and connection logging

### 15.2 Mobile app

- React Native app scaffold is in place as the primary client
- BLE integration boundary is implemented with a native adapter path
- secure storage wrapper for device credentials is implemented
- auth client for pairing, register, refresh, and websocket ticket flows is implemented
- websocket lifecycle manager with heartbeat and reconnect logic is implemented
- repair UI for revoked, expired, and misconfigured states is implemented
- remaining work is device-specific BLE validation and final UUID wiring where
  the production G2 protocol requires it

### 15.3 VPS and deployment

- configure nginx for TLS and websocket proxying
- keep Node and OpenClaw bound to localhost
- add `systemd` units
- add rate limits and log rotation
- add health checks for relay and OpenClaw upstream reachability

### 15.4 Contract and lifecycle tests

- pairing code single-use enforcement
- bootstrap token expiry and replay rejection
- refresh-token rotation
- refresh-token reuse detection and family revocation
- websocket ticket single-use enforcement
- revocation of active sessions
- reconnect after app restart
- reconnect after relay restart
- reconnect during mobile network switching
- rate limiting under brute-force pairing and reconnect storms

## 16. Good Enough for MVP vs Production Hardening Next Steps

### 16.1 Good enough for MVP

- single VPS
- one Node relay process
- Postgres on the same box
- in-memory websocket ticket store
- one active websocket per device
- one default conversation per device
- refresh-token rotation with family revocation
- operator-only pairing session creation via CLI or protected admin page
- mobile client built as a native development build rather than Expo Go when BLE
  is required

### 16.2 Production-hardening next steps

- move ephemeral ticket storage to Redis if the relay scales beyond one process
- add operator SSO for admin endpoints
- add device posture metadata and suspicious-activity alerts
- persist enough prompt state to improve resume behavior across restarts
- add richer conversation management beyond a single default thread
- add observability dashboards and alerting on reconnect storms, refresh reuse, and upstream failures

## 17. Final Defaults to Implement

- canonical public base URL: `https://api.example.com`
- canonical websocket URL: `wss://api.example.com/v1/relay/ws`
- pairing code TTL: 10 minutes
- bootstrap token TTL: 60 seconds
- access token TTL: 5 minutes
- refresh token lifetime: 30 day sliding, 90 day absolute
- websocket ticket TTL: 30 seconds
- heartbeat interval: 25 seconds
- pong timeout: 10 seconds
- stale threshold: 2 missed heartbeats
- reconnect backoff: 1 second to 30 seconds with full jitter
- backoff reset: after 60 seconds of healthy connection

If any existing repo artifact conflicts with these defaults, this document wins.
