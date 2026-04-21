import type { ClientType } from "@openclaw/protocol";

const STORAGE_KEY = "openclaw.mobile.registration";

export interface DeviceRegistration {
  relayBaseUrl: string;
  deviceId: string;
  refreshToken: string;
  deviceDisplayName: string;
  defaultConversationId: string;
  clientType: ClientType;
}

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const DEVICE_REGISTRATION_STORAGE_KEY = STORAGE_KEY;

export class DeviceRegistrationStore {
  constructor(
    private readonly storage: SecureStorageAdapter,
    private readonly storageKey: string = STORAGE_KEY
  ) {}

  async load(): Promise<DeviceRegistration | null> {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<DeviceRegistration>;
      if (!parsed.relayBaseUrl || !parsed.deviceId || !parsed.refreshToken) {
        return null;
      }

      return {
        relayBaseUrl: parsed.relayBaseUrl,
        deviceId: parsed.deviceId,
        refreshToken: parsed.refreshToken,
        deviceDisplayName: parsed.deviceDisplayName || "OpenClaw mobile",
        defaultConversationId: parsed.defaultConversationId || "default",
        clientType: parsed.clientType === "even_hub" ? "even_hub" : "mobile"
      };
    } catch {
      return null;
    }
  }

  async save(registration: DeviceRegistration): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(registration));
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.storageKey);
  }
}

export class InMemorySecureStorageAdapter implements SecureStorageAdapter {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}
