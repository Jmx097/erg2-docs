import type { RegisterDeviceRequest, WebSocketTicketResponse } from "@openclaw/protocol";
import type { BleBridge } from "./ble.js";
import { MobileApiError, MobileAuthClient } from "./auth-client.js";
import { deriveRepairState } from "./repair.js";
import { DeviceRegistrationStore, type DeviceRegistration } from "./secure-storage.js";
import { RelayWebSocketSession } from "./websocket-session.js";

const ACCESS_REFRESH_WINDOW_MS = 60_000;

export interface MobileCompanionSnapshot {
  registration: DeviceRegistration | null;
  accessTokenExpiresAt?: string;
  repairMessage?: string;
}

export class MobileCompanionController {
  private registration: DeviceRegistration | null = null;
  private accessToken = "";
  private accessTokenExpiresAt?: string;
  private latestTicket?: WebSocketTicketResponse;

  constructor(
    private readonly registrationStore: DeviceRegistrationStore,
    private readonly authClient: MobileAuthClient,
    private readonly relaySession: RelayWebSocketSession,
    private readonly bleBridge: BleBridge
  ) {}

  getSnapshot(): MobileCompanionSnapshot {
    return {
      registration: this.registration,
      accessTokenExpiresAt: this.accessTokenExpiresAt
    };
  }

  async restore(): Promise<DeviceRegistration | null> {
    this.registration = await this.registrationStore.load();
    return this.registration;
  }

  async pair(input: {
    relayBaseUrl: string;
    pairingSessionId?: string;
    pairingCode: string;
    deviceDisplayName: string;
    platform: "ios" | "android";
    appVersion: string;
  }): Promise<DeviceRegistration> {
    const redeemed = await this.authClient.redeemPairing(input.relayBaseUrl, {
      pairing_session_id: input.pairingSessionId,
      pairing_code: input.pairingCode
    });
    const registerRequest: RegisterDeviceRequest = {
      device_display_name: input.deviceDisplayName,
      platform: input.platform,
      app_version: input.appVersion,
      client_type: "mobile"
    };
    const registered = await this.authClient.registerDevice(input.relayBaseUrl, redeemed.bootstrap_token, registerRequest);

    this.accessToken = registered.access_token;
    this.accessTokenExpiresAt = registered.access_expires_at;
    this.registration = {
      relayBaseUrl: input.relayBaseUrl,
      deviceId: registered.device_id,
      refreshToken: registered.refresh_token,
      deviceDisplayName: input.deviceDisplayName,
      defaultConversationId: registered.default_conversation_id,
      clientType: registered.client_type
    };
    await this.registrationStore.save(this.registration);
    return this.registration;
  }

  async ensureFreshSession(now: Date = new Date()): Promise<void> {
    const registration = this.requireRegistration();
    if (!this.accessToken || expiresWithin(this.accessTokenExpiresAt, ACCESS_REFRESH_WINDOW_MS, now)) {
      const refreshed = await this.authClient.refreshSession(registration.relayBaseUrl, {
        device_id: registration.deviceId,
        refresh_token: registration.refreshToken
      });

      this.accessToken = refreshed.access_token;
      this.accessTokenExpiresAt = refreshed.access_expires_at;
      this.registration = {
        ...registration,
        refreshToken: refreshed.refresh_token
      };
      await this.registrationStore.save(this.registration);
    }
  }

  async connect(conversationId?: string): Promise<void> {
    const registration = this.requireRegistration();
    await this.ensureFreshSession();
    const resolvedConversationId = conversationId || registration.defaultConversationId;
    this.latestTicket = await this.authClient.issueWebSocketTicket(registration.relayBaseUrl, this.accessToken, {
      conversation_id: resolvedConversationId
    });
    this.relaySession.connect(this.latestTicket, resolvedConversationId);
    await this.bleBridge.connect(registration.deviceId);
  }

  async reconnectAfterNetworkRecovery(): Promise<number | null> {
    await this.ensureFreshSession();
    if (!this.latestTicket || !this.registration) {
      return null;
    }

    this.latestTicket = await this.authClient.issueWebSocketTicket(this.registration.relayBaseUrl, this.accessToken, {
      conversation_id: this.registration.defaultConversationId
    });
    this.relaySession.replaceTicket(this.latestTicket);
    return this.relaySession.handleNetworkRecovered();
  }

  async sendPrompt(promptId: string, text: string): Promise<void> {
    await this.ensureFreshSession();
    this.relaySession.sendPrompt(promptId, text);
  }

  async repairFromError(error: unknown): Promise<MobileCompanionSnapshot> {
    const code = error instanceof MobileApiError ? error.code : undefined;
    const repair = deriveRepairState(code);

    if (repair.recommendedAction === "re_pair") {
      await this.clearRegistration();
    }

    return {
      registration: this.registration,
      accessTokenExpiresAt: this.accessTokenExpiresAt,
      repairMessage: repair.message
    };
  }

  async clearRegistration(): Promise<void> {
    await this.registrationStore.clear();
    this.registration = null;
    this.accessToken = "";
    this.accessTokenExpiresAt = undefined;
    this.latestTicket = undefined;
    this.relaySession.disconnect(1000, "client_repair");
  }

  private requireRegistration(): DeviceRegistration {
    if (!this.registration) {
      throw new Error("Device is not paired.");
    }

    return this.registration;
  }
}

function expiresWithin(expiresAt: string | undefined, thresholdMs: number, now: Date): boolean {
  if (!expiresAt) {
    return true;
  }

  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return parsed - now.getTime() <= thresholdMs;
}
