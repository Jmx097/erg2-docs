import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresBridgeStore } from "./postgres-store.js";
import { BridgeServices } from "./services.js";
import { createTestConfig } from "./test-config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const schemasToDrop: string[] = [];

describe.runIf(Boolean(testDatabaseUrl))("PostgresBridgeStore", () => {
  afterEach(async () => {
    while (schemasToDrop.length > 0) {
      const schemaName = schemasToDrop.pop()!;
      const pool = new Pool({ connectionString: testDatabaseUrl });
      try {
        await pool.query(`drop schema if exists "${schemaName}" cascade`);
      } finally {
        await pool.end();
      }
    }
  });

  it("applies migrations, persists auth state, and cleans expired records", async () => {
    const schemaName = `openclaw_bridge_it_${randomUUID().replace(/-/g, "")}`;
    schemasToDrop.push(schemaName);
    const baseNow = new Date("2026-04-21T00:00:00.000Z");
    const config = createTestConfig({
      bridgeStoreDriver: "postgres",
      databaseUrl: testDatabaseUrl!,
      databaseSchema: schemaName,
      databaseAutoMigrate: true
    });
    const store = await PostgresBridgeStore.create(config);
    const services = new BridgeServices(config, store, undefined, () => baseNow);

    await store.ping();

    const pairing = await services.createPairingSession({
      createdBy: "integration-test",
      platform: "ios",
      deviceDisplayNameHint: "Integration iPhone"
    });
    const redeemed = await services.redeemPairingCode(pairing.pairing_code, pairing.pairing_session_id);
    const registered = await services.registerDevice({
      bootstrapToken: redeemed.bootstrap_token,
      deviceDisplayName: "Integration iPhone",
      platform: "ios",
      appVersion: "0.1.0"
    });
    await services.issueWebSocketTicket({
      accessToken: registered.access_token,
      conversationId: "default"
    });
    await services.markPromptResult({
      deviceId: registered.device_id,
      promptId: "prm_integration",
      conversationId: "default",
      requestId: "req_integration",
      text: "Integration reply"
    });

    const cleanupResult = await store.cleanupExpired(new Date("2026-08-25T00:00:00.000Z"), 1);

    expect(cleanupResult.bootstrapTokensDeleted).toBeGreaterThanOrEqual(1);
    expect(cleanupResult.refreshTokensDeleted).toBeGreaterThanOrEqual(1);
    expect(cleanupResult.websocketTicketsDeleted).toBeGreaterThanOrEqual(1);
    expect(cleanupResult.promptResultsDeleted).toBeGreaterThanOrEqual(1);

    await services.close();
  });
});
