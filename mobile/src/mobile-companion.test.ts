import { describe, expect, it, vi } from "vitest";
import { NoopBleBridge } from "./ble";
import { MobileCompanionController } from "./mobile-companion";
import { InMemorySecureStorageAdapter, DeviceRegistrationStore } from "./secure-storage";
import { RelayWebSocketSession } from "./websocket-session";

describe("MobileCompanionController", () => {
  it("clears the stored registration during repair", async () => {
    const storage = new InMemorySecureStorageAdapter();
    const registrationStore = new DeviceRegistrationStore(storage);
    const relaySession = new RelayWebSocketSession({
      websocketFactory: () => {
        throw new Error("not used");
      }
    });
    const controller = new MobileCompanionController(
      registrationStore,
      {
        redeemPairing: vi.fn(),
        registerDevice: vi.fn(),
        refreshSession: vi.fn(),
        issueWebSocketTicket: vi.fn()
      } as never,
      relaySession,
      new NoopBleBridge()
    );

    await registrationStore.save({
      relayBaseUrl: "https://api.example.com",
      deviceId: "dev_123",
      refreshToken: "rt_123",
      deviceDisplayName: "Jon's iPhone",
      defaultConversationId: "default",
      clientType: "mobile"
    });
    await controller.restore();

    await controller.clearRegistration();

    expect(await registrationStore.load()).toBeNull();
    expect(controller.getSnapshot().registration).toBeNull();
  });
});
