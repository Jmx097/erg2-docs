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

export interface BridgeStore {
  withTransaction<T>(callback: (store: BridgeStore) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  createPairingSession(record: PairingSessionRecord): Promise<void>;
  findPairingSessionByCodeHash(codeHash: string): Promise<PairingSessionRecord | undefined>;
  getPairingSessionById(pairingSessionId: string): Promise<PairingSessionRecord | undefined>;
  updatePairingSession(record: PairingSessionRecord): Promise<void>;
  createBootstrapToken(record: BootstrapTokenRecord): Promise<void>;
  getBootstrapTokenByHash(tokenHash: string): Promise<BootstrapTokenRecord | undefined>;
  updateBootstrapToken(record: BootstrapTokenRecord): Promise<void>;
  createDevice(record: DeviceRecord): Promise<void>;
  getDeviceById(deviceId: string): Promise<DeviceRecord | undefined>;
  updateDevice(record: DeviceRecord): Promise<void>;
  listDevices(): Promise<DeviceRecord[]>;
  createRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void>;
  getRefreshFamilyById(refreshFamilyId: string): Promise<RefreshTokenFamilyRecord | undefined>;
  updateRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void>;
  createRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  updateRefreshToken(record: RefreshTokenRecord): Promise<void>;
  listRefreshTokensByFamilyId(refreshFamilyId: string): Promise<RefreshTokenRecord[]>;
  createWebSocketTicket(record: WebSocketTicketRecord): Promise<void>;
  getWebSocketTicketByHash(ticketHash: string): Promise<WebSocketTicketRecord | undefined>;
  updateWebSocketTicket(record: WebSocketTicketRecord): Promise<void>;
  createRevocation(record: RevocationRecord): Promise<void>;
  createConnectionEvent(record: ConnectionEventRecord): Promise<void>;
  upsertPromptResult(record: PromptResultRecord): Promise<void>;
  getPromptResult(deviceId: string, promptId: string): Promise<PromptResultRecord | undefined>;
  cleanupExpired(now: Date, promptResultRetentionMs: number): Promise<{
    bootstrapTokensDeleted: number;
    refreshTokensDeleted: number;
    websocketTicketsDeleted: number;
    promptResultsDeleted: number;
  }>;
  close?(): Promise<void>;
}
