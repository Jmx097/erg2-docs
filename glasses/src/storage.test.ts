import { describe, expect, it, vi } from "vitest";
import {
  clearStoredRegistration,
  loadStoredClientConfig,
  loadStoredRegistration,
  saveStoredClientConfig,
  saveStoredRegistration
} from "./storage.js";

describe("local storage registration helpers", () => {
  it("loads the stored device registration", async () => {
    const store = new Map<string, string>([
      ["openclaw.g2.relayBaseUrl", "https://relay.example.com"],
      ["openclaw.g2.deviceId", "dev_123"],
      ["openclaw.g2.refreshToken", "rt_456"],
      ["openclaw.g2.deviceDisplayName", "Jon's G2"],
      ["openclaw.g2.defaultConversationId", "default"]
    ]);
    const bridge = {
      getLocalStorage: vi.fn(async (key: string) => store.get(key) || ""),
      setLocalStorage: vi.fn(async () => true)
    };

    await expect(loadStoredRegistration(bridge)).resolves.toEqual({
      relayBaseUrl: "https://relay.example.com",
      deviceId: "dev_123",
      refreshToken: "rt_456",
      deviceDisplayName: "Jon's G2",
      defaultConversationId: "default"
    });
  });

  it("loads local client config including the durable install id", async () => {
    const store = new Map<string, string>([
      ["openclaw.g2.configRelayBaseUrl", "https://relay.example.com"],
      ["openclaw.g2.configDeviceDisplayName", "Jon's G2"],
      ["openclaw.g2.legacyBridgeToken", "bridge-token"],
      ["openclaw.g2.installId", "inst_123"],
      ["openclaw.g2.promptDraft", "ping"]
    ]);
    const bridge = {
      getLocalStorage: vi.fn(async (key: string) => store.get(key) || ""),
      setLocalStorage: vi.fn(async () => true)
    };

    await expect(
      loadStoredClientConfig(bridge, {
        relayBaseUrl: "",
        deviceDisplayName: "OpenClaw G2",
        legacyBridgeToken: "",
        installId: "inst_default",
        promptDraft: "default prompt"
      })
    ).resolves.toEqual({
      relayBaseUrl: "https://relay.example.com",
      deviceDisplayName: "Jon's G2",
      legacyBridgeToken: "bridge-token",
      installId: "inst_123",
      promptDraft: "ping"
    });
  });

  it("stores only the renewable device credentials", async () => {
    const writes = new Map<string, string>();
    const bridge = {
      getLocalStorage: vi.fn(async () => ""),
      setLocalStorage: vi.fn(async (key: string, value: string) => {
        writes.set(key, value);
        return true;
      })
    };

    await saveStoredRegistration(bridge, {
      relayBaseUrl: "https://relay.example.com",
      deviceId: "dev_123",
      refreshToken: "rt_456",
      deviceDisplayName: "Jon's G2",
      defaultConversationId: "default"
    });

    expect([...writes.keys()].sort()).toEqual([
      "openclaw.g2.defaultConversationId",
      "openclaw.g2.deviceDisplayName",
      "openclaw.g2.deviceId",
      "openclaw.g2.refreshToken",
      "openclaw.g2.relayBaseUrl"
    ]);
    expect(writes.has("openclaw.g2.accessToken")).toBe(false);
  });

  it("stores local client config without touching device credentials", async () => {
    const writes = new Map<string, string>();
    const bridge = {
      getLocalStorage: vi.fn(async () => ""),
      setLocalStorage: vi.fn(async (key: string, value: string) => {
        writes.set(key, value);
        return true;
      })
    };

    await saveStoredClientConfig(bridge, {
      relayBaseUrl: "https://relay.example.com",
      deviceDisplayName: "Jon's G2",
      legacyBridgeToken: "bridge-token",
      installId: "inst_123",
      promptDraft: "ping"
    });

    expect([...writes.keys()].sort()).toEqual([
      "openclaw.g2.configDeviceDisplayName",
      "openclaw.g2.configRelayBaseUrl",
      "openclaw.g2.installId",
      "openclaw.g2.legacyBridgeToken",
      "openclaw.g2.promptDraft"
    ]);
    expect(writes.has("openclaw.g2.deviceId")).toBe(false);
  });

  it("clears stored registration for repair flows", async () => {
    const bridge = {
      getLocalStorage: vi.fn(async () => ""),
      setLocalStorage: vi.fn(async () => true)
    };

    await clearStoredRegistration(bridge);

    expect(bridge.setLocalStorage).toHaveBeenCalledTimes(5);
  });
});
