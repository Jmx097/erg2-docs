# Mobile Workspace

This workspace is now a runnable Expo/React Native shell for the production
mobile companion path.

## Run

```bash
cp .env.example .env
npm run dev
```

Useful variants:

```bash
npm run android
npm run ios
npm run web
```

## What It Does

- restores a stored device registration from secure storage on launch
- refreshes the session when needed
- requests a new websocket ticket and connects to the relay
- shows `Pair`, `Connecting`, `Connected`, and `Repair` screens
- handles `ready`, `reply.delta`, `reply.final`, `token.expiring`, `error`, and `revoked`
- uses mocked BLE by default behind a native-ready adapter boundary

## Environment Defaults

- `EXPO_PUBLIC_DEFAULT_RELAY_BASE_URL`
- `EXPO_PUBLIC_DEFAULT_DEVICE_DISPLAY_NAME`

These only seed the pairing form. They are not credentials.

## Key Modules

- `App.tsx`: app shell and screen rendering
- `src/app/use-mobile-companion-app.ts`: UI state orchestration
- `src/mobile-companion.ts`: pairing, restore, refresh, connect, repair logic
- `src/websocket-session.ts`: websocket lifecycle, resume, and reconnect behavior
- `src/adapters/expo-secure-storage.ts`: secure storage adapter for Expo
- `src/adapters/native-websocket.ts`: RN websocket runtime adapter
- `src/ble.ts`: mocked BLE boundary for this slice

## Notes

- Access tokens stay in memory only.
- Long-lived registration material is stored with Expo Secure Store.
- BLE is intentionally mocked in this slice so the app shell is usable before
  real G2 BLE plumbing lands.
