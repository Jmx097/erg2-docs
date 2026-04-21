import type {
  BridgeReadyResponse,
  ClientType,
  ListDevicesResponse,
  PairingSessionResponse,
  RedeemPairingResponse,
  RefreshSessionResponse,
  RegisterDeviceResponse,
  RevokeDeviceResponse,
  WebSocketTicketResponse
} from "@openclaw/protocol";
import type { BridgeConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { hashValue } from "./hash.js";
import { createId, createOpaqueToken, createPairingCode } from "./ids.js";
import { AccessTokenService } from "./access-tokens.js";
import { logBridgeEvent } from "./logger.js";
import { InMemoryBridgeStore } from "./memory-store.js";
import { normalizeConversationId } from "./session-key.js";
import type {
  BootstrapTokenRecord,
  ConnectionEventRecord,
  DeviceRecord,
  PairingSessionRecord,
  PromptResultRecord,
  RefreshTokenFamilyRecord,
  RefreshTokenRecord,
  RevocationRecord,
  WebSocketTicketRecord
} from "./state.js";
import type { BridgeStore } from "./store.js";

const ACCESS_TOKEN_SCOPE = ["device:self", "relay:connect", "turn:send"];

export interface ConsumedWebSocketTicket {
  deviceId: string;
  conversationId: string;
  accessExpiresAt: Date;
}

export class BridgeServices {
  constructor(
    private readonly config: BridgeConfig,
    private readonly store: BridgeStore = new InMemoryBridgeStore(),
    private readonly accessTokens: AccessTokenService = new AccessTokenService(config),
    private readonly now: () => Date = () => new Date()
  ) {}

  getStore(): BridgeStore {
    return this.store;
  }

  async close(): Promise<void> {
    await this.store.close?.();
  }

  async createPairingSession(input: {
    createdBy: string;
    platform?: string;
    deviceDisplayNameHint?: string;
  }): Promise<PairingSessionResponse> {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.config.pairingCodeTtlMs);
    const pairingSessionId = createId("ps");
    const pairingCode = createPairingCode();
    const record: PairingSessionRecord = {
      pairingSessionId,
      codeHash: this.hashPairingCode(pairingCode),
      codeLast4: pairingCode.slice(-4),
      status: "pending",
      createdAt,
      expiresAt,
      failedAttempts: 0,
      createdBy: input.createdBy,
      platform: input.platform?.trim() || "unknown",
      ...(input.deviceDisplayNameHint?.trim() ? { deviceDisplayNameHint: input.deviceDisplayNameHint.trim() } : {})
    };

    await this.store.createPairingSession(record);

    return {
      pairing_session_id: pairingSessionId,
      pairing_code: pairingCode,
      relay_base_url: this.config.relayBaseUrl,
      expires_at: expiresAt.toISOString(),
      qr_payload:
        `openclaw://pair?relay=${encodeURIComponent(this.config.relayBaseUrl)}` +
        `&session=${encodeURIComponent(pairingSessionId)}` +
        `&code=${encodeURIComponent(pairingCode)}`
    };
  }

  async redeemPairingCode(pairingCodeInput: string, pairingSessionIdInput?: string): Promise<RedeemPairingResponse> {
    const pairingCode = normalizePairingCode(pairingCodeInput);
    this.validatePairingCodeInput(pairingCodeInput);

    return this.store.withTransaction(async (store) => {
      const now = this.now();
      const pairingSessionId = pairingSessionIdInput?.trim();
      const codeHash = this.hashPairingCode(pairingCode);
      const session = pairingSessionId
        ? await store.getPairingSessionById(pairingSessionId)
        : await store.findPairingSessionByCodeHash(codeHash);

      if (!session) {
        throw new ApiError("Pairing code not found.", 404, "pairing_code_not_found");
      }

      if (session.status === "locked") {
        throw new ApiError("That pairing code is locked.", 423, "pairing_code_locked");
      }

      if (session.status === "redeemed") {
        throw new ApiError("That pairing code was already used.", 409, "pairing_code_used");
      }

      if (session.expiresAt.getTime() <= now.getTime()) {
        session.status = "expired";
        await store.updatePairingSession(session);
        throw new ApiError("That pairing code expired.", 410, "pairing_code_expired");
      }

      if (pairingSessionId && session.codeHash !== codeHash) {
        session.failedAttempts += 1;

        if (session.failedAttempts >= this.config.pairingCodeMaxAttempts) {
          session.status = "locked";
          await store.updatePairingSession(session);
          throw new ApiError("That pairing code is locked.", 423, "pairing_code_locked");
        }

        await store.updatePairingSession(session);
        throw new ApiError("That pairing code is incorrect.", 400, "pairing_code_incorrect", {
          attempts_remaining: this.config.pairingCodeMaxAttempts - session.failedAttempts
        });
      }

      const bootstrapToken = createOpaqueToken("btp");
      const bootstrapRecord: BootstrapTokenRecord = {
        tokenHash: this.hashOpaque(bootstrapToken),
        pairingSessionId: session.pairingSessionId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.config.bootstrapTokenTtlMs)
      };

      session.status = "redeemed";
      session.redeemedAt = now;
      await store.updatePairingSession(session);
      await store.createBootstrapToken(bootstrapRecord);

      return {
        bootstrap_token: bootstrapToken,
        bootstrap_expires_at: bootstrapRecord.expiresAt.toISOString(),
        pairing_session_id: session.pairingSessionId
      };
    });
  }

  async registerDevice(input: {
    bootstrapToken: string;
    deviceDisplayName?: string;
    platform?: string;
    appVersion?: string;
    clientType?: ClientType;
    remoteIp?: string;
  }): Promise<RegisterDeviceResponse> {
    return this.store.withTransaction(async (store) => {
      const now = this.now();
      const bootstrap = await this.consumeBootstrapToken(store, input.bootstrapToken, now);
      const session = await store.getPairingSessionById(bootstrap.pairingSessionId);

      if (!session) {
        throw new ApiError("Bootstrap session not found.", 404, "bootstrap_session_not_found");
      }

      const clientType = normalizeClientType(input.clientType);
      const deviceId = createId("dev");
      const refreshFamilyId = createId("rtf");
      const device: DeviceRecord = {
        deviceId,
        deviceDisplayName: input.deviceDisplayName?.trim() || session.deviceDisplayNameHint || "Even Hub device",
        platform: input.platform?.trim() || session.platform,
        clientType,
        status: "active",
        createdAt: now,
        lastSeenAt: now,
        lastIp: input.remoteIp,
        lastAppVersion: input.appVersion?.trim(),
        currentRefreshFamilyId: refreshFamilyId
      };
      const family: RefreshTokenFamilyRecord = {
        refreshFamilyId,
        deviceId,
        clientType,
        status: "active",
        createdAt: now
      };
      const refreshIssue = this.issueRefreshToken(device, family, undefined, now);
      const access = await this.accessTokens.issue({
        deviceId,
        scope: ACCESS_TOKEN_SCOPE,
        ttlMs: this.config.accessTokenTtlMs,
        now
      });

      await store.createDevice(device);
      await store.createRefreshFamily(family);
      await store.createRefreshToken(refreshIssue.record);

      return {
        device_id: deviceId,
        access_token: access.token,
        access_expires_at: access.expiresAt.toISOString(),
        refresh_token: refreshIssue.rawToken,
        refresh_expires_at: refreshIssue.record.expiresAt.toISOString(),
        refresh_family_id: refreshFamilyId,
        default_conversation_id: "default",
        client_type: clientType
      };
    });
  }

  async refreshSession(input: {
    deviceId: string;
    refreshToken: string;
    remoteIp?: string;
  }): Promise<RefreshSessionResponse> {
    return this.store.withTransaction(async (store) => {
      const deviceId = input.deviceId.trim();
      const device = await store.getDeviceById(deviceId);

      if (!device || device.status !== "active") {
        throw new ApiError("Device is not active.", 401, "device_inactive");
      }

      const rawHash = this.hashOpaque(input.refreshToken);
      const tokenRecord = await store.getRefreshTokenByHash(rawHash);

      if (!tokenRecord) {
        throw new ApiError("Refresh token is invalid.", 401, "refresh_invalid");
      }

      const family = await store.getRefreshFamilyById(tokenRecord.refreshFamilyId);
      if (!family || family.deviceId !== deviceId) {
        throw new ApiError("Refresh token is invalid.", 401, "refresh_invalid");
      }

      if (family.status !== "active" || device.status !== "active") {
        throw new ApiError("Device session has been revoked.", 401, "device_revoked");
      }

      const now = this.now();

      if (tokenRecord.usedAt) {
        await this.markFamilyCompromised(store, family, device, "refresh_token_reuse_detected", now);
        throw new ApiError("Refresh token reuse detected. Device repair required.", 401, "refresh_reuse_detected");
      }

      if (tokenRecord.revokedAt || tokenRecord.expiresAt.getTime() <= now.getTime()) {
        throw new ApiError("Refresh token expired.", 401, "refresh_expired");
      }

      const refreshIssue = this.issueRefreshToken(device, family, tokenRecord, now);
      const access = await this.accessTokens.issue({
        deviceId,
        scope: ACCESS_TOKEN_SCOPE,
        ttlMs: this.config.accessTokenTtlMs,
        now
      });

      tokenRecord.usedAt = now;
      tokenRecord.replacedByRefreshTokenId = refreshIssue.record.refreshTokenId;
      device.lastSeenAt = now;
      device.lastIp = input.remoteIp ?? device.lastIp;

      await store.updateRefreshToken(tokenRecord);
      await store.createRefreshToken(refreshIssue.record);
      await store.updateDevice(device);

      return {
        access_token: access.token,
        access_expires_at: access.expiresAt.toISOString(),
        refresh_token: refreshIssue.rawToken,
        refresh_expires_at: refreshIssue.record.expiresAt.toISOString(),
        refresh_family_id: family.refreshFamilyId,
        client_type: device.clientType
      };
    });
  }

  async issueWebSocketTicket(input: {
    accessToken: string;
    conversationId?: string;
  }): Promise<WebSocketTicketResponse> {
    const verified = await this.verifyAccessToken(input.accessToken, ["relay:connect"]);
    const conversationId = normalizeConversationId(input.conversationId || "default");
    const now = this.now();
    const ticket = createOpaqueToken("wst");
    const expiresAt = new Date(now.getTime() + this.config.wsTicketTtlMs);
    const ticketRecord: WebSocketTicketRecord = {
      ticketHash: this.hashOpaque(ticket),
      ticketId: createId("wstrec"),
      deviceId: verified.deviceId,
      conversationId,
      accessExpiresAt: verified.expiresAt,
      createdAt: now,
      expiresAt
    };

    await this.store.withTransaction(async (store) => {
      await store.createWebSocketTicket(ticketRecord);
      const device = await store.getDeviceById(verified.deviceId);
      if (device) {
        device.lastSeenAt = now;
        await store.updateDevice(device);
      }
    });

    const relayUrl = new URL("/v1/relay/ws", toWebSocketBaseUrl(this.config.relayBaseUrl));
    relayUrl.searchParams.set("ticket", ticket);

    return {
      ticket,
      expires_at: expiresAt.toISOString(),
      ws_url: relayUrl.toString()
    };
  }

  async verifyAccessToken(token: string, requiredScopes: string[] = []) {
    try {
      const verified = await this.accessTokens.verify(token, requiredScopes);
      const device = await this.store.getDeviceById(verified.deviceId);

      if (!device || device.status !== "active") {
        throw new ApiError("Device session has been revoked.", 401, "device_revoked");
      }

      return verified;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError("Access token is invalid or expired.", 401, "access_invalid");
    }
  }

  async consumeWebSocketTicket(rawTicket: string): Promise<ConsumedWebSocketTicket> {
    return this.store.withTransaction(async (store) => {
      const now = this.now();
      const hash = this.hashOpaque(rawTicket);
      const record = await store.getWebSocketTicketByHash(hash);

      if (!record || record.expiresAt.getTime() <= now.getTime() || record.usedAt) {
        throw new ApiError("Websocket ticket is invalid.", 401, "invalid_ticket");
      }

      const device = await store.getDeviceById(record.deviceId);
      if (!device || device.status !== "active") {
        throw new ApiError("Device session has been revoked.", 401, "device_revoked");
      }

      record.usedAt = now;
      device.lastSeenAt = now;

      await store.updateWebSocketTicket(record);
      await store.updateDevice(device);

      return {
        deviceId: record.deviceId,
        conversationId: record.conversationId,
        accessExpiresAt: record.accessExpiresAt
      };
    });
  }

  async listDevices(): Promise<ListDevicesResponse> {
    const devices = await this.store.listDevices();

    return {
      devices: devices
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map((device) => ({
          device_id: device.deviceId,
          device_display_name: device.deviceDisplayName,
          platform: device.platform,
          status: device.status,
          client_type: device.clientType,
          ...(device.lastSeenAt ? { last_seen_at: device.lastSeenAt.toISOString() } : {})
        }))
    };
  }

  async revokeDevice(input: {
    deviceId: string;
    reason: string;
    createdBy: string;
  }): Promise<RevokeDeviceResponse> {
    return this.store.withTransaction(async (store) => {
      const device = await store.getDeviceById(input.deviceId);

      if (!device) {
        throw new ApiError("Device not found.", 404, "device_not_found");
      }

      const now = this.now();
      device.status = "revoked";
      device.revokedAt = now;
      device.revokeReason = input.reason;
      await store.updateDevice(device);

      const family = await store.getRefreshFamilyById(device.currentRefreshFamilyId);
      if (family) {
        family.status = "revoked";
        family.revokeReason = input.reason;
        await store.updateRefreshFamily(family);
      }

      const familyTokens = await store.listRefreshTokensByFamilyId(device.currentRefreshFamilyId);
      for (const token of familyTokens) {
        if (!token.revokedAt) {
          token.revokedAt = now;
          await store.updateRefreshToken(token);
        }
      }

      const revocation: RevocationRecord = {
        revocationId: createId("rev"),
        subjectType: "device",
        subjectId: device.deviceId,
        reason: input.reason,
        createdAt: now,
        createdBy: input.createdBy
      };
      await store.createRevocation(revocation);

      return {
        device_id: device.deviceId,
        status: "revoked",
        revoked_at: now.toISOString(),
        disconnect_active_sessions: true
      };
    });
  }

  async markPromptResult(input: {
    deviceId: string;
    promptId: string;
    conversationId: string;
    requestId: string;
    text: string;
  }): Promise<void> {
    const record: PromptResultRecord = {
      deviceId: input.deviceId,
      promptId: input.promptId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      text: input.text,
      createdAt: this.now()
    };

    await this.store.upsertPromptResult(record);
  }

  async getPromptResult(deviceId: string, promptId: string): Promise<PromptResultRecord | undefined> {
    return this.store.getPromptResult(deviceId, promptId);
  }

  async checkReadiness(openclawHealthy: boolean): Promise<BridgeReadyResponse> {
    let database = false;

    try {
      await this.store.ping();
      database = true;
    } catch {
      database = false;
    }

    const storage = this.config.bridgeStoreDriver;
    const ready = database && openclawHealthy && storage === "postgres";

    return {
      ok: ready,
      ready,
      bridge: "openclaw-mobile-companion",
      storage,
      checks: {
        database,
        openclaw: openclawHealthy
      }
    };
  }

  async cleanupExpiredState(): Promise<void> {
    const now = this.now();
    const deleted = await this.store.cleanupExpired(now, this.config.promptResultRetentionMs);

    if (Object.values(deleted).some((count) => count > 0)) {
      logBridgeEvent({
        event: "bridge_cleanup",
        storage: this.config.bridgeStoreDriver,
        ...deleted
      });
    }
  }

  async recordConnectionEvent(input: {
    deviceId: string;
    connectionId: string;
    eventType: string;
    ip?: string;
    closeCode?: number;
    detailsJson?: Record<string, unknown>;
  }): Promise<void> {
    const record: ConnectionEventRecord = {
      connectionEventId: createId("ce"),
      deviceId: input.deviceId,
      connectionId: input.connectionId,
      eventType: input.eventType,
      occurredAt: this.now(),
      ip: input.ip,
      closeCode: input.closeCode,
      detailsJson: input.detailsJson
    };
    await this.store.createConnectionEvent(record);
  }

  async touchDevice(deviceId: string, now: Date, details?: { remoteIp?: string; appVersion?: string }): Promise<void> {
    const device = await this.store.getDeviceById(deviceId);

    if (!device) {
      return;
    }

    device.lastSeenAt = now;

    if (details?.remoteIp) {
      device.lastIp = details.remoteIp;
    }

    if (details?.appVersion) {
      device.lastAppVersion = details.appVersion;
    }

    await this.store.updateDevice(device);
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    return this.store.getDeviceById(deviceId);
  }

  private hashOpaque(rawValue: string): string {
    return hashValue(this.config.tokenHashSecret, rawValue);
  }

  private hashPairingCode(pairingCode: string): string {
    return hashValue(this.config.tokenHashSecret, pairingCode);
  }

  private validatePairingCodeInput(value: string): void {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new ApiError("Pairing code is required.", 400, "pairing_code_required");
    }

    if (/^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)) {
      throw new ApiError(
        "This looks like a relay URL, not a pairing code. Paste it into the Relay URL field.",
        400,
        "pairing_code_looks_like_url"
      );
    }

    if (trimmed.split(".").length === 3 || trimmed.length > 32) {
      throw new ApiError(
        "This looks like a token. This app pairs with a short code or QR scan, not a pasted bearer token.",
        400,
        "pairing_code_looks_like_token"
      );
    }

    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(trimmed)) {
      throw new ApiError("Pairing code must match XXXX-XXXX.", 400, "pairing_code_invalid_format");
    }
  }

  private async consumeBootstrapToken(store: BridgeStore, rawToken: string, now: Date): Promise<BootstrapTokenRecord> {
    const tokenHash = this.hashOpaque(rawToken);
    const record = await store.getBootstrapTokenByHash(tokenHash);

    if (!record) {
      throw new ApiError("Bootstrap token is invalid.", 401, "bootstrap_invalid");
    }

    if (record.usedAt) {
      throw new ApiError("Bootstrap token was already used.", 409, "bootstrap_used");
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new ApiError("Bootstrap token expired.", 401, "bootstrap_expired");
    }

    record.usedAt = now;
    await store.updateBootstrapToken(record);
    return record;
  }

  private issueRefreshToken(
    device: DeviceRecord,
    family: RefreshTokenFamilyRecord,
    parent: RefreshTokenRecord | undefined,
    now: Date
  ): {
    rawToken: string;
    record: RefreshTokenRecord;
  } {
    const rawToken = createOpaqueToken("rt");
    const policy = selectRefreshPolicy(device.clientType, this.config);
    const familyAbsoluteExpiry = new Date(family.createdAt.getTime() + policy.absoluteTtlMs);
    const slidingExpiry = new Date(now.getTime() + policy.slidingTtlMs);
    const expiresAt = slidingExpiry.getTime() < familyAbsoluteExpiry.getTime() ? slidingExpiry : familyAbsoluteExpiry;
    const refreshTokenId = createId("rtr");
    const record: RefreshTokenRecord = {
      refreshTokenId,
      refreshFamilyId: family.refreshFamilyId,
      tokenHash: this.hashOpaque(rawToken),
      parentRefreshTokenId: parent?.refreshTokenId,
      issuedAt: now,
      expiresAt
    };

    return { rawToken, record };
  }

  private async markFamilyCompromised(
    store: BridgeStore,
    family: RefreshTokenFamilyRecord,
    device: DeviceRecord,
    reason: string,
    now: Date
  ): Promise<void> {
    family.status = "compromised";
    family.compromisedAt = now;
    family.revokeReason = reason;
    device.status = "repair_required";
    device.revokeReason = reason;

    await store.updateRefreshFamily(family);
    await store.updateDevice(device);

    const familyTokens = await store.listRefreshTokensByFamilyId(family.refreshFamilyId);
    for (const token of familyTokens) {
      if (!token.revokedAt) {
        token.revokedAt = now;
        await store.updateRefreshToken(token);
      }
    }

    const revocation: RevocationRecord = {
      revocationId: createId("rev"),
      subjectType: "family",
      subjectId: family.refreshFamilyId,
      reason,
      createdAt: now,
      createdBy: "system"
    };
    await store.createRevocation(revocation);
  }
}

export function normalizePairingCode(value: string): string {
  return value.trim().toUpperCase();
}

function toWebSocketBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
}

function normalizeClientType(value: ClientType | undefined): ClientType {
  return value === "even_hub" ? "even_hub" : "mobile";
}

function selectRefreshPolicy(
  clientType: ClientType,
  config: Pick<
    BridgeConfig,
    | "refreshTokenSlidingTtlMs"
    | "refreshTokenAbsoluteTtlMs"
    | "evenHubRefreshTokenSlidingTtlMs"
    | "evenHubRefreshTokenAbsoluteTtlMs"
  >
): {
  slidingTtlMs: number;
  absoluteTtlMs: number;
} {
  if (clientType === "even_hub") {
    return {
      slidingTtlMs: config.evenHubRefreshTokenSlidingTtlMs,
      absoluteTtlMs: config.evenHubRefreshTokenAbsoluteTtlMs
    };
  }

  return {
    slidingTtlMs: config.refreshTokenSlidingTtlMs,
    absoluteTtlMs: config.refreshTokenAbsoluteTtlMs
  };
}
