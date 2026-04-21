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

interface InMemoryBridgeState {
  pairingSessions: Map<string, PairingSessionRecord>;
  pairingSessionsByCodeHash: Map<string, string>;
  bootstrapTokens: Map<string, BootstrapTokenRecord>;
  devices: Map<string, DeviceRecord>;
  refreshFamilies: Map<string, RefreshTokenFamilyRecord>;
  refreshTokens: Map<string, RefreshTokenRecord>;
  refreshTokensByFamilyId: Map<string, Set<string>>;
  websocketTickets: Map<string, WebSocketTicketRecord>;
  revocations: RevocationRecord[];
  connectionEvents: ConnectionEventRecord[];
  promptResults: Map<string, PromptResultRecord>;
}

export class InMemoryBridgeStore implements BridgeStore {
  private readonly state: InMemoryBridgeState = {
    pairingSessions: new Map<string, PairingSessionRecord>(),
    pairingSessionsByCodeHash: new Map<string, string>(),
    bootstrapTokens: new Map<string, BootstrapTokenRecord>(),
    devices: new Map<string, DeviceRecord>(),
    refreshFamilies: new Map<string, RefreshTokenFamilyRecord>(),
    refreshTokens: new Map<string, RefreshTokenRecord>(),
    refreshTokensByFamilyId: new Map<string, Set<string>>(),
    websocketTickets: new Map<string, WebSocketTicketRecord>(),
    revocations: [],
    connectionEvents: [],
    promptResults: new Map<string, PromptResultRecord>()
  };

  async withTransaction<T>(callback: (store: BridgeStore) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async ping(): Promise<void> {
    return;
  }

  async createPairingSession(record: PairingSessionRecord): Promise<void> {
    this.state.pairingSessions.set(record.pairingSessionId, record);
    this.state.pairingSessionsByCodeHash.set(record.codeHash, record.pairingSessionId);
  }

  async findPairingSessionByCodeHash(codeHash: string): Promise<PairingSessionRecord | undefined> {
    const pairingSessionId = this.state.pairingSessionsByCodeHash.get(codeHash);
    return pairingSessionId ? this.state.pairingSessions.get(pairingSessionId) : undefined;
  }

  async getPairingSessionById(pairingSessionId: string): Promise<PairingSessionRecord | undefined> {
    return this.state.pairingSessions.get(pairingSessionId);
  }

  async updatePairingSession(record: PairingSessionRecord): Promise<void> {
    this.state.pairingSessions.set(record.pairingSessionId, record);
    this.state.pairingSessionsByCodeHash.set(record.codeHash, record.pairingSessionId);
  }

  async createBootstrapToken(record: BootstrapTokenRecord): Promise<void> {
    this.state.bootstrapTokens.set(record.tokenHash, record);
  }

  async getBootstrapTokenByHash(tokenHash: string): Promise<BootstrapTokenRecord | undefined> {
    return this.state.bootstrapTokens.get(tokenHash);
  }

  async updateBootstrapToken(record: BootstrapTokenRecord): Promise<void> {
    this.state.bootstrapTokens.set(record.tokenHash, record);
  }

  async createDevice(record: DeviceRecord): Promise<void> {
    this.state.devices.set(record.deviceId, record);
  }

  async getDeviceById(deviceId: string): Promise<DeviceRecord | undefined> {
    return this.state.devices.get(deviceId);
  }

  async updateDevice(record: DeviceRecord): Promise<void> {
    this.state.devices.set(record.deviceId, record);
  }

  async listDevices(): Promise<DeviceRecord[]> {
    return [...this.state.devices.values()];
  }

  async createRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void> {
    this.state.refreshFamilies.set(record.refreshFamilyId, record);
  }

  async getRefreshFamilyById(refreshFamilyId: string): Promise<RefreshTokenFamilyRecord | undefined> {
    return this.state.refreshFamilies.get(refreshFamilyId);
  }

  async updateRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void> {
    this.state.refreshFamilies.set(record.refreshFamilyId, record);
  }

  async createRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.state.refreshTokens.set(record.tokenHash, record);
    let familySet = this.state.refreshTokensByFamilyId.get(record.refreshFamilyId);
    if (!familySet) {
      familySet = new Set<string>();
      this.state.refreshTokensByFamilyId.set(record.refreshFamilyId, familySet);
    }
    familySet.add(record.tokenHash);
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    return this.state.refreshTokens.get(tokenHash);
  }

  async updateRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.state.refreshTokens.set(record.tokenHash, record);
    let familySet = this.state.refreshTokensByFamilyId.get(record.refreshFamilyId);
    if (!familySet) {
      familySet = new Set<string>();
      this.state.refreshTokensByFamilyId.set(record.refreshFamilyId, familySet);
    }
    familySet.add(record.tokenHash);
  }

  async listRefreshTokensByFamilyId(refreshFamilyId: string): Promise<RefreshTokenRecord[]> {
    const familySet = this.state.refreshTokensByFamilyId.get(refreshFamilyId);
    if (!familySet) {
      return [];
    }

    return [...familySet]
      .map((tokenHash) => this.state.refreshTokens.get(tokenHash))
      .filter((record): record is RefreshTokenRecord => Boolean(record));
  }

  async createWebSocketTicket(record: WebSocketTicketRecord): Promise<void> {
    this.state.websocketTickets.set(record.ticketHash, record);
  }

  async getWebSocketTicketByHash(ticketHash: string): Promise<WebSocketTicketRecord | undefined> {
    return this.state.websocketTickets.get(ticketHash);
  }

  async updateWebSocketTicket(record: WebSocketTicketRecord): Promise<void> {
    this.state.websocketTickets.set(record.ticketHash, record);
  }

  async createRevocation(record: RevocationRecord): Promise<void> {
    this.state.revocations.push(record);
  }

  async createConnectionEvent(record: ConnectionEventRecord): Promise<void> {
    this.state.connectionEvents.push(record);
  }

  async upsertPromptResult(record: PromptResultRecord): Promise<void> {
    this.state.promptResults.set(promptResultKey(record.deviceId, record.promptId), record);
  }

  async getPromptResult(deviceId: string, promptId: string): Promise<PromptResultRecord | undefined> {
    return this.state.promptResults.get(promptResultKey(deviceId, promptId));
  }

  async cleanupExpired(now: Date, promptResultRetentionMs: number): Promise<{
    bootstrapTokensDeleted: number;
    refreshTokensDeleted: number;
    websocketTicketsDeleted: number;
    promptResultsDeleted: number;
  }> {
    let bootstrapTokensDeleted = 0;
    for (const [tokenHash, record] of this.state.bootstrapTokens.entries()) {
      if (record.expiresAt.getTime() <= now.getTime()) {
        this.state.bootstrapTokens.delete(tokenHash);
        bootstrapTokensDeleted += 1;
      }
    }

    let refreshTokensDeleted = 0;
    for (const [tokenHash, record] of this.state.refreshTokens.entries()) {
      if (record.expiresAt.getTime() <= now.getTime()) {
        this.state.refreshTokens.delete(tokenHash);
        this.state.refreshTokensByFamilyId.get(record.refreshFamilyId)?.delete(tokenHash);
        refreshTokensDeleted += 1;
      }
    }

    let websocketTicketsDeleted = 0;
    for (const [ticketHash, record] of this.state.websocketTickets.entries()) {
      if (record.expiresAt.getTime() <= now.getTime() || Boolean(record.usedAt)) {
        this.state.websocketTickets.delete(ticketHash);
        websocketTicketsDeleted += 1;
      }
    }

    const cutoffMs = now.getTime() - promptResultRetentionMs;
    let promptResultsDeleted = 0;
    for (const [key, record] of this.state.promptResults.entries()) {
      if (record.createdAt.getTime() <= cutoffMs) {
        this.state.promptResults.delete(key);
        promptResultsDeleted += 1;
      }
    }

    return {
      bootstrapTokensDeleted,
      refreshTokensDeleted,
      websocketTicketsDeleted,
      promptResultsDeleted
    };
  }
}

function promptResultKey(deviceId: string, promptId: string): string {
  return `${deviceId}:${promptId}`;
}
