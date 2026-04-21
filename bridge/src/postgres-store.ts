import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { BridgeConfig } from "./config.js";
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

interface PostgresBridgeStoreOptions {
  pool?: Pool;
  client?: PoolClient;
  tableNames: ReturnType<typeof buildTableNames>;
  ownPool: boolean;
  transactional: boolean;
}

export class PostgresBridgeStore implements BridgeStore {
  private readonly pool?: Pool;
  private readonly client?: PoolClient;
  private readonly tableNames: ReturnType<typeof buildTableNames>;
  private readonly ownPool: boolean;
  private readonly transactional: boolean;

  constructor(options: PostgresBridgeStoreOptions) {
    this.pool = options.pool;
    this.client = options.client;
    this.tableNames = options.tableNames;
    this.ownPool = options.ownPool;
    this.transactional = options.transactional;
  }

  static async create(config: Pick<BridgeConfig, "databaseUrl" | "databaseSchema" | "databaseAutoMigrate">): Promise<PostgresBridgeStore> {
    const pool = new Pool({
      connectionString: config.databaseUrl
    });
    const tableNames = buildTableNames(config.databaseSchema);

    if (config.databaseAutoMigrate) {
      await runMigrations(pool, config.databaseSchema);
    }

    return new PostgresBridgeStore({
      pool,
      tableNames,
      ownPool: true,
      transactional: false
    });
  }

  async withTransaction<T>(callback: (store: BridgeStore) => Promise<T>): Promise<T> {
    if (this.transactional) {
      return callback(this);
    }

    if (!this.pool) {
      throw new Error("Postgres pool is not available");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const transactionalStore = new PostgresBridgeStore({
        client,
        tableNames: this.tableNames,
        ownPool: false,
        transactional: true
      });
      const result = await callback(transactionalStore);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.query("select 1");
  }

  async createPairingSession(record: PairingSessionRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.pairingSessions}
        (pairing_session_id, code_hash, code_last4, status, created_at, expires_at, redeemed_at, failed_attempts, created_by, platform, device_display_name_hint)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.pairingSessionId,
        record.codeHash,
        record.codeLast4,
        record.status,
        record.createdAt,
        record.expiresAt,
        record.redeemedAt ?? null,
        record.failedAttempts,
        record.createdBy,
        record.platform,
        record.deviceDisplayNameHint ?? null
      ]
    );
  }

  async findPairingSessionByCodeHash(codeHash: string): Promise<PairingSessionRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.pairingSessions} where code_hash = $1 limit 1`, [codeHash]);
    return result.rows[0] ? mapPairingSession(result.rows[0]) : undefined;
  }

  async getPairingSessionById(pairingSessionId: string): Promise<PairingSessionRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.pairingSessions} where pairing_session_id = $1 limit 1`, [
      pairingSessionId
    ]);
    return result.rows[0] ? mapPairingSession(result.rows[0]) : undefined;
  }

  async updatePairingSession(record: PairingSessionRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.pairingSessions}
          set code_hash = $2,
              code_last4 = $3,
              status = $4,
              created_at = $5,
              expires_at = $6,
              redeemed_at = $7,
              failed_attempts = $8,
              created_by = $9,
              platform = $10,
              device_display_name_hint = $11
        where pairing_session_id = $1`,
      [
        record.pairingSessionId,
        record.codeHash,
        record.codeLast4,
        record.status,
        record.createdAt,
        record.expiresAt,
        record.redeemedAt ?? null,
        record.failedAttempts,
        record.createdBy,
        record.platform,
        record.deviceDisplayNameHint ?? null
      ]
    );
  }

  async createBootstrapToken(record: BootstrapTokenRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.bootstrapTokens}
        (token_hash, pairing_session_id, created_at, expires_at, used_at)
       values ($1, $2, $3, $4, $5)`,
      [record.tokenHash, record.pairingSessionId, record.createdAt, record.expiresAt, record.usedAt ?? null]
    );
  }

  async getBootstrapTokenByHash(tokenHash: string): Promise<BootstrapTokenRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.bootstrapTokens} where token_hash = $1 limit 1`, [tokenHash]);
    return result.rows[0] ? mapBootstrapToken(result.rows[0]) : undefined;
  }

  async updateBootstrapToken(record: BootstrapTokenRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.bootstrapTokens}
          set pairing_session_id = $2,
              created_at = $3,
              expires_at = $4,
              used_at = $5
        where token_hash = $1`,
      [record.tokenHash, record.pairingSessionId, record.createdAt, record.expiresAt, record.usedAt ?? null]
    );
  }

  async createDevice(record: DeviceRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.devices}
        (device_id, device_display_name, platform, client_type, status, created_at, last_seen_at, last_ip, last_app_version, current_refresh_family_id, revoked_at, revoke_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.deviceId,
        record.deviceDisplayName,
        record.platform,
        record.clientType,
        record.status,
        record.createdAt,
        record.lastSeenAt ?? null,
        record.lastIp ?? null,
        record.lastAppVersion ?? null,
        record.currentRefreshFamilyId,
        record.revokedAt ?? null,
        record.revokeReason ?? null
      ]
    );
  }

  async getDeviceById(deviceId: string): Promise<DeviceRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.devices} where device_id = $1 limit 1`, [deviceId]);
    return result.rows[0] ? mapDevice(result.rows[0]) : undefined;
  }

  async updateDevice(record: DeviceRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.devices}
          set device_display_name = $2,
              platform = $3,
              client_type = $4,
              status = $5,
              created_at = $6,
              last_seen_at = $7,
              last_ip = $8,
              last_app_version = $9,
              current_refresh_family_id = $10,
              revoked_at = $11,
              revoke_reason = $12
        where device_id = $1`,
      [
        record.deviceId,
        record.deviceDisplayName,
        record.platform,
        record.clientType,
        record.status,
        record.createdAt,
        record.lastSeenAt ?? null,
        record.lastIp ?? null,
        record.lastAppVersion ?? null,
        record.currentRefreshFamilyId,
        record.revokedAt ?? null,
        record.revokeReason ?? null
      ]
    );
  }

  async listDevices(): Promise<DeviceRecord[]> {
    const result = await this.query(`select * from ${this.tableNames.devices} order by created_at asc`);
    return result.rows.map(mapDevice);
  }

  async createRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.refreshFamilies}
        (refresh_family_id, device_id, client_type, status, created_at, compromised_at, revoke_reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.refreshFamilyId,
        record.deviceId,
        record.clientType,
        record.status,
        record.createdAt,
        record.compromisedAt ?? null,
        record.revokeReason ?? null
      ]
    );
  }

  async getRefreshFamilyById(refreshFamilyId: string): Promise<RefreshTokenFamilyRecord | undefined> {
    const result = await this.query(
      `select * from ${this.tableNames.refreshFamilies} where refresh_family_id = $1 limit 1`,
      [refreshFamilyId]
    );
    return result.rows[0] ? mapRefreshFamily(result.rows[0]) : undefined;
  }

  async updateRefreshFamily(record: RefreshTokenFamilyRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.refreshFamilies}
          set device_id = $2,
              client_type = $3,
              status = $4,
              created_at = $5,
              compromised_at = $6,
              revoke_reason = $7
        where refresh_family_id = $1`,
      [
        record.refreshFamilyId,
        record.deviceId,
        record.clientType,
        record.status,
        record.createdAt,
        record.compromisedAt ?? null,
        record.revokeReason ?? null
      ]
    );
  }

  async createRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.refreshTokens}
        (refresh_token_id, refresh_family_id, token_hash, parent_refresh_token_id, issued_at, expires_at, used_at, replaced_by_refresh_token_id, revoked_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.refreshTokenId,
        record.refreshFamilyId,
        record.tokenHash,
        record.parentRefreshTokenId ?? null,
        record.issuedAt,
        record.expiresAt,
        record.usedAt ?? null,
        record.replacedByRefreshTokenId ?? null,
        record.revokedAt ?? null
      ]
    );
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.refreshTokens} where token_hash = $1 limit 1`, [tokenHash]);
    return result.rows[0] ? mapRefreshToken(result.rows[0]) : undefined;
  }

  async updateRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.refreshTokens}
          set refresh_family_id = $2,
              parent_refresh_token_id = $3,
              issued_at = $4,
              expires_at = $5,
              used_at = $6,
              replaced_by_refresh_token_id = $7,
              revoked_at = $8
        where token_hash = $1`,
      [
        record.tokenHash,
        record.refreshFamilyId,
        record.parentRefreshTokenId ?? null,
        record.issuedAt,
        record.expiresAt,
        record.usedAt ?? null,
        record.replacedByRefreshTokenId ?? null,
        record.revokedAt ?? null
      ]
    );
  }

  async listRefreshTokensByFamilyId(refreshFamilyId: string): Promise<RefreshTokenRecord[]> {
    const result = await this.query(
      `select * from ${this.tableNames.refreshTokens} where refresh_family_id = $1 order by issued_at asc`,
      [refreshFamilyId]
    );
    return result.rows.map(mapRefreshToken);
  }

  async createWebSocketTicket(record: WebSocketTicketRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.websocketTickets}
        (ticket_hash, ticket_id, device_id, conversation_id, access_expires_at, created_at, expires_at, used_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.ticketHash,
        record.ticketId,
        record.deviceId,
        record.conversationId,
        record.accessExpiresAt,
        record.createdAt,
        record.expiresAt,
        record.usedAt ?? null
      ]
    );
  }

  async getWebSocketTicketByHash(ticketHash: string): Promise<WebSocketTicketRecord | undefined> {
    const result = await this.query(`select * from ${this.tableNames.websocketTickets} where ticket_hash = $1 limit 1`, [
      ticketHash
    ]);
    return result.rows[0] ? mapWebsocketTicket(result.rows[0]) : undefined;
  }

  async updateWebSocketTicket(record: WebSocketTicketRecord): Promise<void> {
    await this.query(
      `update ${this.tableNames.websocketTickets}
          set ticket_id = $2,
              device_id = $3,
              conversation_id = $4,
              access_expires_at = $5,
              created_at = $6,
              expires_at = $7,
              used_at = $8
        where ticket_hash = $1`,
      [
        record.ticketHash,
        record.ticketId,
        record.deviceId,
        record.conversationId,
        record.accessExpiresAt,
        record.createdAt,
        record.expiresAt,
        record.usedAt ?? null
      ]
    );
  }

  async createRevocation(record: RevocationRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.revocations}
        (revocation_id, subject_type, subject_id, reason, created_at, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [record.revocationId, record.subjectType, record.subjectId, record.reason, record.createdAt, record.createdBy]
    );
  }

  async createConnectionEvent(record: ConnectionEventRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.connectionEvents}
        (connection_event_id, device_id, connection_id, event_type, occurred_at, ip, close_code, details_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        record.connectionEventId,
        record.deviceId,
        record.connectionId,
        record.eventType,
        record.occurredAt,
        record.ip ?? null,
        record.closeCode ?? null,
        record.detailsJson ? JSON.stringify(record.detailsJson) : null
      ]
    );
  }

  async upsertPromptResult(record: PromptResultRecord): Promise<void> {
    await this.query(
      `insert into ${this.tableNames.promptResults}
        (device_id, prompt_id, conversation_id, request_id, text, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (device_id, prompt_id)
       do update set conversation_id = excluded.conversation_id,
                     request_id = excluded.request_id,
                     text = excluded.text,
                     created_at = excluded.created_at`,
      [record.deviceId, record.promptId, record.conversationId, record.requestId, record.text, record.createdAt]
    );
  }

  async getPromptResult(deviceId: string, promptId: string): Promise<PromptResultRecord | undefined> {
    const result = await this.query(
      `select * from ${this.tableNames.promptResults} where device_id = $1 and prompt_id = $2 limit 1`,
      [deviceId, promptId]
    );
    return result.rows[0] ? mapPromptResult(result.rows[0]) : undefined;
  }

  async cleanupExpired(now: Date, promptResultRetentionMs: number): Promise<{
    bootstrapTokensDeleted: number;
    refreshTokensDeleted: number;
    websocketTicketsDeleted: number;
    promptResultsDeleted: number;
  }> {
    const promptCutoff = new Date(now.getTime() - promptResultRetentionMs);
    const [bootstrapTokensDeleted, refreshTokensDeleted, websocketTicketsDeleted, promptResultsDeleted] = await Promise.all([
      this.query(`delete from ${this.tableNames.bootstrapTokens} where expires_at <= $1`, [now]),
      this.query(`delete from ${this.tableNames.refreshTokens} where expires_at <= $1`, [now]),
      this.query(`delete from ${this.tableNames.websocketTickets} where expires_at <= $1 or used_at is not null`, [now]),
      this.query(`delete from ${this.tableNames.promptResults} where created_at <= $1`, [promptCutoff])
    ]);

    return {
      bootstrapTokensDeleted: bootstrapTokensDeleted.rowCount ?? 0,
      refreshTokensDeleted: refreshTokensDeleted.rowCount ?? 0,
      websocketTicketsDeleted: websocketTicketsDeleted.rowCount ?? 0,
      promptResultsDeleted: promptResultsDeleted.rowCount ?? 0
    };
  }

  async close(): Promise<void> {
    if (this.ownPool && this.pool) {
      await this.pool.end();
    }
  }

  private async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    if (this.client) {
      return this.client.query<T>(text, values);
    }

    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    throw new Error("Postgres client is not available");
  }
}

async function runMigrations(pool: Pool, schemaName: string): Promise<void> {
  const quotedSchema = quoteIdentifier(schemaName);

  await pool.query(`create schema if not exists ${quotedSchema}`);
  await pool.query(`
    create table if not exists ${quotedSchema}."schema_migrations" (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedVersions = new Set(
    (
      await pool.query<{ version: string }>(`select version from ${quotedSchema}."schema_migrations" order by version asc`)
    ).rows.map((row) => row.version)
  );

  for (const migration of loadSqlMigrations()) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await pool.query("BEGIN");

    try {
      await pool.query(migration.sql.replaceAll("{{schema}}", quotedSchema));
      await pool.query(`insert into ${quotedSchema}."schema_migrations" (version) values ($1)`, [migration.version]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw new Error(`Failed applying migration ${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function loadSqlMigrations(): Array<{ version: string; fileName: string; sql: string }> {
  const directory = resolveMigrationsDirectory();
  const entries = readdirSync(directory)
    .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  return entries.map((fileName) => {
    const match = /^(\d+)_/.exec(fileName);
    if (!match) {
      throw new Error(`Invalid migration filename: ${fileName}`);
    }

    return {
      version: match[1]!,
      fileName,
      sql: readFileSync(path.join(directory, fileName), "utf8")
    };
  });
}

function resolveMigrationsDirectory(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "bridge", "migrations"),
    path.resolve(process.cwd(), "migrations"),
    path.resolve(moduleDir, "..", "migrations")
  ];

  const directory = candidates.find((candidate) => existsSync(candidate));
  if (!directory) {
    throw new Error("Could not locate bridge SQL migrations directory.");
  }

  return directory;
}

function buildTableNames(schemaName: string) {
  return {
    pairingSessions: qualifyTable(schemaName, "pairing_sessions"),
    bootstrapTokens: qualifyTable(schemaName, "bootstrap_tokens"),
    devices: qualifyTable(schemaName, "paired_devices"),
    refreshFamilies: qualifyTable(schemaName, "refresh_token_families"),
    refreshTokens: qualifyTable(schemaName, "refresh_tokens"),
    websocketTickets: qualifyTable(schemaName, "websocket_tickets"),
    revocations: qualifyTable(schemaName, "revocations"),
    connectionEvents: qualifyTable(schemaName, "connection_events"),
    promptResults: qualifyTable(schemaName, "prompt_results")
  };
}

function qualifyTable(schemaName: string, tableName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }

  return `"${value}"`;
}

function mapPairingSession(row: QueryResultRow): PairingSessionRecord {
  return {
    pairingSessionId: readString(row, "pairing_session_id"),
    codeHash: readString(row, "code_hash"),
    codeLast4: readString(row, "code_last4"),
    status: readString(row, "status") as PairingSessionRecord["status"],
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    redeemedAt: readOptionalDate(row, "redeemed_at"),
    failedAttempts: Number(row.failed_attempts ?? 0),
    createdBy: readString(row, "created_by"),
    platform: readString(row, "platform"),
    deviceDisplayNameHint: readOptionalString(row, "device_display_name_hint")
  };
}

function mapBootstrapToken(row: QueryResultRow): BootstrapTokenRecord {
  return {
    tokenHash: readString(row, "token_hash"),
    pairingSessionId: readString(row, "pairing_session_id"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    usedAt: readOptionalDate(row, "used_at")
  };
}

function mapDevice(row: QueryResultRow): DeviceRecord {
  return {
    deviceId: readString(row, "device_id"),
    deviceDisplayName: readString(row, "device_display_name"),
    platform: readString(row, "platform"),
    clientType: readString(row, "client_type") as DeviceRecord["clientType"],
    status: readString(row, "status") as DeviceRecord["status"],
    createdAt: readDate(row, "created_at"),
    lastSeenAt: readOptionalDate(row, "last_seen_at"),
    lastIp: readOptionalString(row, "last_ip"),
    lastAppVersion: readOptionalString(row, "last_app_version"),
    currentRefreshFamilyId: readString(row, "current_refresh_family_id"),
    revokedAt: readOptionalDate(row, "revoked_at"),
    revokeReason: readOptionalString(row, "revoke_reason")
  };
}

function mapRefreshFamily(row: QueryResultRow): RefreshTokenFamilyRecord {
  return {
    refreshFamilyId: readString(row, "refresh_family_id"),
    deviceId: readString(row, "device_id"),
    clientType: readString(row, "client_type") as RefreshTokenFamilyRecord["clientType"],
    status: readString(row, "status") as RefreshTokenFamilyRecord["status"],
    createdAt: readDate(row, "created_at"),
    compromisedAt: readOptionalDate(row, "compromised_at"),
    revokeReason: readOptionalString(row, "revoke_reason")
  };
}

function mapRefreshToken(row: QueryResultRow): RefreshTokenRecord {
  return {
    refreshTokenId: readString(row, "refresh_token_id"),
    refreshFamilyId: readString(row, "refresh_family_id"),
    tokenHash: readString(row, "token_hash"),
    parentRefreshTokenId: readOptionalString(row, "parent_refresh_token_id"),
    issuedAt: readDate(row, "issued_at"),
    expiresAt: readDate(row, "expires_at"),
    usedAt: readOptionalDate(row, "used_at"),
    replacedByRefreshTokenId: readOptionalString(row, "replaced_by_refresh_token_id"),
    revokedAt: readOptionalDate(row, "revoked_at")
  };
}

function mapWebsocketTicket(row: QueryResultRow): WebSocketTicketRecord {
  return {
    ticketHash: readString(row, "ticket_hash"),
    ticketId: readString(row, "ticket_id"),
    deviceId: readString(row, "device_id"),
    conversationId: readString(row, "conversation_id"),
    accessExpiresAt: readDate(row, "access_expires_at"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    usedAt: readOptionalDate(row, "used_at")
  };
}

function mapPromptResult(row: QueryResultRow): PromptResultRecord {
  return {
    deviceId: readString(row, "device_id"),
    promptId: readString(row, "prompt_id"),
    conversationId: readString(row, "conversation_id"),
    requestId: readString(row, "request_id"),
    text: readString(row, "text"),
    createdAt: readDate(row, "created_at")
  };
}

function readString(row: QueryResultRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function readOptionalString(row: QueryResultRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readDate(row: QueryResultRow, key: string): Date {
  return new Date(readString(row, key));
}

function readOptionalDate(row: QueryResultRow, key: string): Date | undefined {
  const value = row[key];
  return value ? new Date(String(value)) : undefined;
}
