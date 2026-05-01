import { describe, expect, it, vi } from "vitest";
import { EvenHubAppController } from "./app-controller.js";
import { BridgeApiError } from "./bridge.js";

describe("EvenHubAppController", () => {
  it("refreshes on foreground enter when the access token is near expiry", async () => {
    const api = {
      health: vi.fn(async () => ({ ok: true, bridge: "openclaw-mobile-companion" })),
      redeemPairing: vi.fn(),
      registerDevice: vi.fn(),
      refreshSession: vi.fn(async () => ({
        access_token: "new-access",
        access_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        refresh_token: "new-refresh",
        refresh_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        refresh_family_id: "rtf_123",
        client_type: "even_hub"
      })),
      sendTurn: vi.fn()
    };
    const storage = createStorageBridge({
      "openclaw.g2.configRelayBaseUrl": "https://relay.example.com",
      "openclaw.g2.configDeviceDisplayName": "Jon's G2",
      "openclaw.g2.relayBaseUrl": "https://relay.example.com",
      "openclaw.g2.deviceId": "dev_123",
      "openclaw.g2.refreshToken": "rt_123",
      "openclaw.g2.deviceDisplayName": "Jon's G2",
      "openclaw.g2.defaultConversationId": "default"
    });
    const controller = new EvenHubAppController(storage, api as any);

    await controller.boot();
    await controller.handleForegroundEnter();

    expect(api.refreshSession).toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("connected");
  });

  it("falls back to the legacy direct turn path when only relay url and token are stored", async () => {
    const api = {
      health: vi.fn(),
      legacyHealth: vi.fn(async () => ({ ok: true, bridge: "g2-openclaw-bridge" })),
      redeemPairing: vi.fn(),
      registerDevice: vi.fn(),
      refreshSession: vi.fn(),
      sendTurn: vi.fn(),
      sendLegacyTurn: vi.fn(async () => ({
        reply: "alive",
        model: "openclaw/default",
        sessionKey: "g2:inst_123",
        requestId: "turn_legacy"
      }))
    };
    const controller = new EvenHubAppController(
      createStorageBridge({
        "openclaw.g2.configRelayBaseUrl": "https://relay.example.com",
        "openclaw.g2.configDeviceDisplayName": "Jon's G2",
        "openclaw.g2.legacyBridgeToken": "bridge-token",
        "openclaw.g2.installId": "inst_123"
      }),
      api as any
    );

    await controller.boot();
    await controller.sendPrompt();

    expect(api.legacyHealth).toHaveBeenCalled();
    expect(api.sendLegacyTurn).toHaveBeenCalledWith(
      "https://relay.example.com",
      "bridge-token",
      expect.objectContaining({
        installId: "inst_123"
      }),
      expect.any(AbortSignal)
    );
    expect(controller.getSnapshot()).toMatchObject({
      status: "connected",
      transportMode: "legacy_v0",
      lastReply: "alive"
    });
  });

  it("moves into repair_required when the backend revokes the device", async () => {
    const api = {
      health: vi.fn(async () => ({ ok: true, bridge: "openclaw-mobile-companion" })),
      redeemPairing: vi.fn(),
      registerDevice: vi.fn(),
      refreshSession: vi.fn(async () => {
        throw new BridgeApiError("Device session has been revoked.", 401, "device_revoked");
      }),
      sendTurn: vi.fn()
    };
    const controller = new EvenHubAppController(
      createStorageBridge({
        "openclaw.g2.configRelayBaseUrl": "https://relay.example.com",
        "openclaw.g2.configDeviceDisplayName": "Jon's G2",
        "openclaw.g2.relayBaseUrl": "https://relay.example.com",
        "openclaw.g2.deviceId": "dev_123",
        "openclaw.g2.refreshToken": "rt_123",
        "openclaw.g2.deviceDisplayName": "Jon's G2",
        "openclaw.g2.defaultConversationId": "default"
      }),
      api as any
    );

    await controller.boot();

    expect(controller.getSnapshot().status).toBe("repair_required");
  });

  it("keeps a reconnect path after abnormal exits and recovers on the next foreground", async () => {
    const api = {
      health: vi.fn(async () => ({ ok: true, bridge: "openclaw-mobile-companion" })),
      redeemPairing: vi.fn(),
      registerDevice: vi.fn(),
      refreshSession: vi.fn(async () => ({
        access_token: "new-access",
        access_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        refresh_token: "new-refresh",
        refresh_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        refresh_family_id: "rtf_123",
        client_type: "even_hub"
      })),
      sendTurn: vi.fn()
    };
    const controller = new EvenHubAppController(
      createStorageBridge({
        "openclaw.g2.configRelayBaseUrl": "https://relay.example.com",
        "openclaw.g2.configDeviceDisplayName": "Jon's G2",
        "openclaw.g2.relayBaseUrl": "https://relay.example.com",
        "openclaw.g2.deviceId": "dev_123",
        "openclaw.g2.refreshToken": "rt_123",
        "openclaw.g2.deviceDisplayName": "Jon's G2",
        "openclaw.g2.defaultConversationId": "default"
      }),
      api as any
    );

    await controller.boot();
    controller.handleAbnormalExit();
    expect(controller.getSnapshot().status).toBe("reconnect_needed");

    await controller.handleForegroundEnter();
    expect(controller.getSnapshot().status).toBe("connected");
  });
});

function createStorageBridge(values: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(values));
  return {
    getLocalStorage: vi.fn(async (key: string) => store.get(key) || ""),
    setLocalStorage: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return true;
    })
  };
}
