import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BridgeConfig {
  environment: "development" | "test" | "production";
  port: number;
  relayBaseUrl: string;
  bridgeStoreDriver: "memory" | "postgres";
  databaseUrl: string;
  databaseSchema: string;
  databaseAutoMigrate: boolean;
  startupRequireReady: boolean;
  adminApiToken: string;
  tokenHashSecret: string;
  accessTokenPrivateKey: string;
  accessTokenPublicKey: string;
  accessTokenIssuer: string;
  accessTokenAudience: string;
  openclawBaseUrl: string;
  openclawGatewayToken: string;
  g2BridgeToken: string;
  openclawModel: string;
  openclawRequestTimeoutMs: number;
  openclawHealthCheck: boolean;
  pairingCodeTtlMs: number;
  bootstrapTokenTtlMs: number;
  pairingCodeMaxAttempts: number;
  accessTokenTtlMs: number;
  refreshTokenSlidingTtlMs: number;
  refreshTokenAbsoluteTtlMs: number;
  evenHubRefreshTokenSlidingTtlMs: number;
  evenHubRefreshTokenAbsoluteTtlMs: number;
  wsTicketTtlMs: number;
  relayHeartbeatIntervalMs: number;
  relayPongTimeoutMs: number;
  relayStaleMissCount: number;
  cleanupIntervalMs: number;
  promptResultRetentionMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const runtimeEnv = env === process.env ? resolveRuntimeEnv(env) : env;
  const environment = readEnvironment(runtimeEnv.NODE_ENV);
  const port = readInt(runtimeEnv.PORT, 8787);
  const databaseUrl = runtimeEnv.DATABASE_URL?.trim() || "";
  const bridgeStoreDriver = readStoreDriver(runtimeEnv.BRIDGE_STORE_DRIVER, databaseUrl ? "postgres" : "memory");

  if (bridgeStoreDriver === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when BRIDGE_STORE_DRIVER=postgres");
  }

  return {
    environment,
    port,
    relayBaseUrl: normalizePublicBaseUrl(runtimeEnv.RELAY_BASE_URL?.trim() || `http://127.0.0.1:${port}`),
    bridgeStoreDriver,
    databaseUrl,
    databaseSchema: runtimeEnv.DATABASE_SCHEMA?.trim() || "openclaw_bridge",
    databaseAutoMigrate: readBool(runtimeEnv.DATABASE_AUTO_MIGRATE, bridgeStoreDriver === "postgres"),
    startupRequireReady: readBool(
      runtimeEnv.STARTUP_REQUIRE_READY,
      environment === "production" || bridgeStoreDriver === "postgres"
    ),
    adminApiToken: readRequired(runtimeEnv.ADMIN_API_TOKEN, "ADMIN_API_TOKEN"),
    tokenHashSecret: readRequired(
      runtimeEnv.TOKEN_HASH_SECRET?.trim() || runtimeEnv.ACCESS_TOKEN_SECRET?.trim(),
      "TOKEN_HASH_SECRET"
    ),
    accessTokenPrivateKey: readRequired(
      normalizePem(runtimeEnv.ACCESS_TOKEN_PRIVATE_KEY),
      "ACCESS_TOKEN_PRIVATE_KEY"
    ),
    accessTokenPublicKey: readRequired(
      normalizePem(runtimeEnv.ACCESS_TOKEN_PUBLIC_KEY),
      "ACCESS_TOKEN_PUBLIC_KEY"
    ),
    accessTokenIssuer: runtimeEnv.ACCESS_TOKEN_ISSUER?.trim() || "openclaw-mobile-companion",
    accessTokenAudience: runtimeEnv.ACCESS_TOKEN_AUDIENCE?.trim() || "openclaw-mobile",
    openclawBaseUrl: normalizeBaseUrl(readRequired(runtimeEnv.OPENCLAW_BASE_URL, "OPENCLAW_BASE_URL")),
    openclawGatewayToken: readRequired(runtimeEnv.OPENCLAW_GATEWAY_TOKEN, "OPENCLAW_GATEWAY_TOKEN"),
    g2BridgeToken: runtimeEnv.G2_BRIDGE_TOKEN?.trim() || "",
    openclawModel: runtimeEnv.OPENCLAW_MODEL?.trim() || "openclaw/default",
    openclawRequestTimeoutMs: readInt(runtimeEnv.OPENCLAW_REQUEST_TIMEOUT_MS, 30_000),
    openclawHealthCheck: readBool(runtimeEnv.OPENCLAW_HEALTH_CHECK, true),
    pairingCodeTtlMs: readInt(runtimeEnv.PAIRING_CODE_TTL_MS, 10 * 60 * 1000),
    bootstrapTokenTtlMs: readInt(runtimeEnv.BOOTSTRAP_TOKEN_TTL_MS, 60 * 1000),
    pairingCodeMaxAttempts: readInt(runtimeEnv.PAIRING_CODE_MAX_ATTEMPTS, 10),
    accessTokenTtlMs: readInt(runtimeEnv.ACCESS_TOKEN_TTL_MS, 5 * 60 * 1000),
    refreshTokenSlidingTtlMs: readInt(runtimeEnv.REFRESH_TOKEN_SLIDING_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    refreshTokenAbsoluteTtlMs: readInt(runtimeEnv.REFRESH_TOKEN_ABSOLUTE_TTL_MS, 90 * 24 * 60 * 60 * 1000),
    evenHubRefreshTokenSlidingTtlMs: readInt(
      runtimeEnv.EVEN_HUB_REFRESH_TOKEN_SLIDING_TTL_MS,
      7 * 24 * 60 * 60 * 1000
    ),
    evenHubRefreshTokenAbsoluteTtlMs: readInt(
      runtimeEnv.EVEN_HUB_REFRESH_TOKEN_ABSOLUTE_TTL_MS,
      30 * 24 * 60 * 60 * 1000
    ),
    wsTicketTtlMs: readInt(runtimeEnv.WS_TICKET_TTL_MS, 30 * 1000),
    relayHeartbeatIntervalMs: readInt(runtimeEnv.RELAY_HEARTBEAT_INTERVAL_MS, 25 * 1000),
    relayPongTimeoutMs: readInt(runtimeEnv.RELAY_PONG_TIMEOUT_MS, 10 * 1000),
    relayStaleMissCount: readInt(runtimeEnv.RELAY_STALE_MISS_COUNT, 2),
    cleanupIntervalMs: readInt(runtimeEnv.CLEANUP_INTERVAL_MS, 60 * 1000),
    promptResultRetentionMs: readInt(runtimeEnv.PROMPT_RESULT_RETENTION_MS, 24 * 60 * 60 * 1000)
  };
}

export function resolveRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
  candidatePaths: string[] = defaultEnvFileCandidates()
): NodeJS.ProcessEnv {
  const fileEnv = readFirstEnvFile(candidatePaths);
  return { ...fileEnv, ...env };
}

function readRequired(value: string | undefined, key: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return trimmed;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readStoreDriver(value: string | undefined, fallback: "memory" | "postgres"): "memory" | "postgres" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "memory" || normalized === "postgres") {
    return normalized;
  }

  return fallback;
}

function readEnvironment(value: string | undefined): "development" | "test" | "production" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "test") {
    return normalized;
  }

  return "development";
}

function normalizeBaseUrl(value: string): string {
  const normalizedScheme = value
    .trim()
    .replace(/^ws:\/\//i, "http://")
    .replace(/^wss:\/\//i, "https://");

  return normalizedScheme.replace(/\/+$/, "");
}

function normalizePublicBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePem(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/\\n/g, "\n");
}

function defaultEnvFileCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  return [...new Set([
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "bridge", ".env"),
    path.resolve(moduleDir, "..", ".env")
  ])];
}

function readFirstEnvFile(candidatePaths: string[]): Record<string, string> {
  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return parseEnvFile(readFileSync(candidatePath, "utf8"));
    }
  }

  return {};
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    values[key] = unwrapEnvValue(rawValue);
  }

  return values;
}

function unwrapEnvValue(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
