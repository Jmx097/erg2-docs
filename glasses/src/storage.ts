import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

const STORAGE_KEYS = {
  configRelayBaseUrl: "openclaw.g2.configRelayBaseUrl",
  registrationRelayBaseUrl: "openclaw.g2.relayBaseUrl",
  deviceId: "openclaw.g2.deviceId",
  refreshToken: "openclaw.g2.refreshToken",
  configDeviceDisplayName: "openclaw.g2.configDeviceDisplayName",
  registrationDeviceDisplayName: "openclaw.g2.deviceDisplayName",
  defaultConversationId: "openclaw.g2.defaultConversationId",
  installId: "openclaw.g2.installId",
  legacyBridgeToken: "openclaw.g2.legacyBridgeToken",
  promptDraft: "openclaw.g2.promptDraft"
} as const;

export interface StoredClientConfig {
  relayBaseUrl: string;
  deviceDisplayName: string;
  legacyBridgeToken: string;
  installId: string;
  promptDraft: string;
}

export interface StoredDeviceRegistration {
  relayBaseUrl: string;
  deviceId: string;
  refreshToken: string;
  deviceDisplayName: string;
  defaultConversationId: string;
}

export type LocalStorageBridge = Pick<EvenAppBridge, "getLocalStorage" | "setLocalStorage">;

export async function loadStoredClientConfig(
  bridge: LocalStorageBridge,
  defaults: StoredClientConfig
): Promise<StoredClientConfig> {
  const [relayBaseUrl, deviceDisplayName, legacyBridgeToken, installId, promptDraft] = await Promise.all([
    bridge.getLocalStorage(STORAGE_KEYS.configRelayBaseUrl),
    bridge.getLocalStorage(STORAGE_KEYS.configDeviceDisplayName),
    bridge.getLocalStorage(STORAGE_KEYS.legacyBridgeToken),
    bridge.getLocalStorage(STORAGE_KEYS.installId),
    bridge.getLocalStorage(STORAGE_KEYS.promptDraft)
  ]);

  const [registrationRelayBaseUrl, registrationDeviceDisplayName] = await Promise.all([
    bridge.getLocalStorage(STORAGE_KEYS.registrationRelayBaseUrl),
    bridge.getLocalStorage(STORAGE_KEYS.registrationDeviceDisplayName)
  ]);

  return {
    relayBaseUrl: relayBaseUrl.trim() || registrationRelayBaseUrl.trim() || defaults.relayBaseUrl,
    deviceDisplayName: deviceDisplayName.trim() || registrationDeviceDisplayName.trim() || defaults.deviceDisplayName,
    legacyBridgeToken: legacyBridgeToken.trim() || defaults.legacyBridgeToken,
    installId: installId.trim() || defaults.installId,
    promptDraft: promptDraft.trim() || defaults.promptDraft
  };
}

export async function loadStoredRegistration(bridge: LocalStorageBridge): Promise<StoredDeviceRegistration | null> {
  const [relayBaseUrl, deviceId, refreshToken, deviceDisplayName, defaultConversationId] = await Promise.all([
    bridge.getLocalStorage(STORAGE_KEYS.registrationRelayBaseUrl),
    bridge.getLocalStorage(STORAGE_KEYS.deviceId),
    bridge.getLocalStorage(STORAGE_KEYS.refreshToken),
    bridge.getLocalStorage(STORAGE_KEYS.registrationDeviceDisplayName),
    bridge.getLocalStorage(STORAGE_KEYS.defaultConversationId)
  ]);

  if (!relayBaseUrl.trim() || !deviceId.trim() || !refreshToken.trim()) {
    return null;
  }

  return {
    relayBaseUrl: relayBaseUrl.trim(),
    deviceId: deviceId.trim(),
    refreshToken: refreshToken.trim(),
    deviceDisplayName: deviceDisplayName.trim() || "Even Hub device",
    defaultConversationId: defaultConversationId.trim() || "default"
  };
}

export async function saveStoredRegistration(
  bridge: LocalStorageBridge,
  registration: StoredDeviceRegistration
): Promise<void> {
  await Promise.all([
    bridge.setLocalStorage(STORAGE_KEYS.registrationRelayBaseUrl, registration.relayBaseUrl),
    bridge.setLocalStorage(STORAGE_KEYS.deviceId, registration.deviceId),
    bridge.setLocalStorage(STORAGE_KEYS.refreshToken, registration.refreshToken),
    bridge.setLocalStorage(STORAGE_KEYS.registrationDeviceDisplayName, registration.deviceDisplayName),
    bridge.setLocalStorage(STORAGE_KEYS.defaultConversationId, registration.defaultConversationId)
  ]);
}

export async function saveStoredClientConfig(bridge: LocalStorageBridge, config: StoredClientConfig): Promise<void> {
  await Promise.all([
    bridge.setLocalStorage(STORAGE_KEYS.configRelayBaseUrl, config.relayBaseUrl),
    bridge.setLocalStorage(STORAGE_KEYS.configDeviceDisplayName, config.deviceDisplayName),
    bridge.setLocalStorage(STORAGE_KEYS.legacyBridgeToken, config.legacyBridgeToken),
    bridge.setLocalStorage(STORAGE_KEYS.installId, config.installId),
    bridge.setLocalStorage(STORAGE_KEYS.promptDraft, config.promptDraft)
  ]);
}

export async function clearStoredRegistration(bridge: LocalStorageBridge): Promise<void> {
  await Promise.all(
    [
      STORAGE_KEYS.registrationRelayBaseUrl,
      STORAGE_KEYS.deviceId,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.registrationDeviceDisplayName,
      STORAGE_KEYS.defaultConversationId
    ].map((key) => {
      return bridge.setLocalStorage(key, "");
    })
  );
}
