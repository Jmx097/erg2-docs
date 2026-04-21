import { describe, expect, it, vi } from "vitest";
import { OpenClawRequestError } from "./openclaw.js";
import { createBridgeApp, createBridgeRuntime, type OpenClawChatPort } from "./server.js";
import { createTestConfig } from "./test-config.js";

const config = createTestConfig();

describe("bridge app", () => {
  it("rejects unauthenticated legacy health checks", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));

    const response = await app.request("/health");

    expect(response.status).toBe(401);
  });

  it("allows authenticated legacy health checks", async () => {
    const openclaw = mockOpenClaw();
    const app = createBridgeApp(config, createBridgeRuntime(config, openclaw));

    const response = await app.request("/health", {
      headers: { authorization: "Bearer bridge-token" }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(openclaw.checkHealth).toHaveBeenCalledOnce();
  });

  it("maps install ids to g2 session keys on the legacy v0 route", async () => {
    const openclaw = mockOpenClaw();
    const app = createBridgeApp(config, createBridgeRuntime(config, openclaw));

    const response = await app.request("/v0/turn", {
      method: "POST",
      headers: {
        authorization: "Bearer bridge-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        installId: "abc-123",
        prompt: "ping"
      })
    });

    expect(response.status).toBe(200);
    expect(openclaw.createChatCompletion).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^turn_[0-9a-f]{20}$/),
      sessionKey: "g2:abc-123",
      prompt: "ping"
    });
  });

  it("returns request metadata on typed upstream failures from the legacy route", async () => {
    const openclaw = mockOpenClaw({
      createChatCompletion: vi.fn(async () => {
        throw new OpenClawRequestError("OpenClaw timed out", "timeout");
      })
    });
    const app = createBridgeApp(config, createBridgeRuntime(config, openclaw));

    const response = await app.request("/v0/turn", {
      method: "POST",
      headers: {
        authorization: "Bearer bridge-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        installId: "abc-123",
        prompt: "ping"
      })
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "OpenClaw timed out",
      failureKind: "timeout",
      requestId: expect.stringMatching(/^turn_[0-9a-f]{20}$/)
    });
  });

  it("creates pairing sessions for admins only", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));

    const unauthorized = await app.request("/v1/pairing/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "even_hub" })
    });
    expect(unauthorized.status).toBe(401);

    const response = await app.request("/v1/pairing/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        platform: "even_hub",
        device_display_name_hint: "Jon's G2"
      })
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      pairing_session_id: expect.stringMatching(/^ps_[0-9a-f]{20}$/),
      pairing_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      relay_base_url: "https://api.example.com"
    });
  });

  it("exposes a non-ready readiness response until postgres-backed production mode is in use", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));

    const response = await app.request("/v1/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ready: false,
      storage: "memory",
      checks: {
        database: true,
        openclaw: true
      }
    });
  });

  it("redeems, registers, refreshes, and lists devices on the v1 flow", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));
    const pairing = await createPairingSession(app);

    const redeemResponse = await app.request("/v1/pairing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_session_id: pairing.pairing_session_id,
        pairing_code: pairing.pairing_code
      })
    });
    const redeemed = await redeemResponse.json();

    const registerResponse = await app.request("/v1/devices/register", {
      method: "POST",
      headers: {
        authorization: `Bearer ${redeemed.bootstrap_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        device_display_name: "Jon's Phone",
        platform: "ios",
        app_version: "0.1.0"
      })
    });
    expect(registerResponse.status).toBe(201);
    const registered = await registerResponse.json();
    expect(registered).toMatchObject({
      device_id: expect.stringMatching(/^dev_[0-9a-f]{20}$/),
      access_token: expect.any(String),
      refresh_token: expect.stringMatching(/^rt_[0-9a-f]{32}$/),
      refresh_family_id: expect.stringMatching(/^rtf_[0-9a-f]{20}$/),
      client_type: "mobile"
    });

    const refreshResponse = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: registered.device_id,
        refresh_token: registered.refresh_token
      })
    });
    expect(refreshResponse.status).toBe(200);
    const refreshed = await refreshResponse.json();
    expect(refreshed.refresh_token).not.toBe(registered.refresh_token);

    const wsTicketResponse = await app.request("/v1/auth/ws-ticket", {
      method: "POST",
      headers: {
        authorization: `Bearer ${refreshed.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ conversation_id: "default" })
    });
    expect(wsTicketResponse.status).toBe(201);

    const listResponse = await app.request("/v1/devices", {
      headers: { authorization: "Bearer admin-token" }
    });
    expect(await listResponse.json()).toMatchObject({
      devices: [
        expect.objectContaining({
          device_id: registered.device_id,
          device_display_name: "Jon's Phone",
          client_type: "mobile",
          status: "active"
        })
      ]
    });
  });

  it("locks a pairing session after repeated incorrect attempts when the pairing session id is supplied", async () => {
    const app = createBridgeApp(
      createTestConfig({ pairingCodeMaxAttempts: 2 }),
      createBridgeRuntime(createTestConfig({ pairingCodeMaxAttempts: 2 }), mockOpenClaw())
    );
    const pairing = await createPairingSession(app);

    const firstResponse = await app.request("/v1/pairing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_session_id: pairing.pairing_session_id,
        pairing_code: "ZZZZ-9999"
      })
    });
    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toMatchObject({
      code: "pairing_code_incorrect",
      details: {
        attempts_remaining: 1
      }
    });

    const secondResponse = await app.request("/v1/pairing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_session_id: pairing.pairing_session_id,
        pairing_code: "ZZZZ-9999"
      })
    });
    expect(secondResponse.status).toBe(423);
    expect(await secondResponse.json()).toMatchObject({
      code: "pairing_code_locked"
    });
  });

  it("marks refresh token reuse as a repair-required condition", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));
    const registered = await registerDevice(app);

    const firstRefresh = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: registered.device_id,
        refresh_token: registered.refresh_token
      })
    });
    expect(firstRefresh.status).toBe(200);

    const secondRefresh = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: registered.device_id,
        refresh_token: registered.refresh_token
      })
    });
    expect(secondRefresh.status).toBe(401);
    expect(await secondRefresh.json()).toMatchObject({
      code: "refresh_reuse_detected"
    });
  });

  it("rejects URL-like pairing code mistakes with a targeted error", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));

    const response = await app.request("/v1/pairing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_code: "https://api.example.com" })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "pairing_code_looks_like_url"
    });
  });

  it("requires an access token for v1 turn requests", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));

    const response = await app.request("/v1/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: "default",
        prompt_id: "prm_123",
        text: "ping"
      })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "authorization_required"
    });
  });

  it("deduplicates v1 turn requests by prompt_id", async () => {
    const openclaw = mockOpenClaw();
    const app = createBridgeApp(config, createBridgeRuntime(config, openclaw));
    const registered = await registerDevice(app, "even_hub");

    const firstResponse = await app.request("/v1/turn", {
      method: "POST",
      headers: {
        authorization: `Bearer ${registered.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        conversation_id: "default",
        prompt_id: "prm_123",
        text: "ping"
      })
    });
    expect(firstResponse.status).toBe(200);
    const firstJson = await firstResponse.json();

    const secondResponse = await app.request("/v1/turn", {
      method: "POST",
      headers: {
        authorization: `Bearer ${registered.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        conversation_id: "default",
        prompt_id: "prm_123",
        text: "ping"
      })
    });
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual(firstJson);
    expect(openclaw.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(openclaw.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: expect.stringMatching(/^mobile:dev_[0-9a-f]{20}:conversation:default$/),
        messageChannel: "g2"
      })
    );
  });

  it("blocks revoked devices from refreshing and calling v1 turn", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));
    const registered = await registerDevice(app, "even_hub");

    const revokeResponse = await app.request(`/v1/devices/${registered.device_id}/revoke`, {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ reason: "device_lost" })
    });
    expect(revokeResponse.status).toBe(200);

    const refreshResponse = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: registered.device_id,
        refresh_token: registered.refresh_token
      })
    });
    expect(refreshResponse.status).toBe(401);
    expect(await refreshResponse.json()).toMatchObject({
      code: "device_inactive"
    });

    const turnResponse = await app.request("/v1/turn", {
      method: "POST",
      headers: {
        authorization: `Bearer ${registered.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        conversation_id: "default",
        prompt_id: "prm_revoke",
        text: "ping"
      })
    });
    expect(turnResponse.status).toBe(401);
    expect(await turnResponse.json()).toMatchObject({
      code: "device_revoked"
    });
  });

  it("uses shorter refresh lifetimes for even_hub clients", async () => {
    const app = createBridgeApp(config, createBridgeRuntime(config, mockOpenClaw()));
    const registered = await registerDevice(app, "even_hub");
    const refreshExpiryMs = Date.parse(registered.refresh_expires_at) - Date.now();

    expect(refreshExpiryMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    expect(refreshExpiryMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(registered.client_type).toBe("even_hub");
  });
});

async function createPairingSession(app: ReturnType<typeof createBridgeApp>) {
  const response = await app.request("/v1/pairing/sessions", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ platform: "even_hub" })
  });

  expect(response.status).toBe(201);
  return response.json();
}

async function registerDevice(app: ReturnType<typeof createBridgeApp>, clientType?: "even_hub") {
  const pairing = await createPairingSession(app);
  const redeemResponse = await app.request("/v1/pairing/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairing_session_id: pairing.pairing_session_id,
      pairing_code: pairing.pairing_code
    })
  });
  const redeemed = await redeemResponse.json();

  const registerResponse = await app.request("/v1/devices/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${redeemed.bootstrap_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      device_display_name: "Jon's G2",
      platform: "even_hub",
      app_version: "0.1.0",
      ...(clientType ? { client_type: clientType } : {})
    })
  });

  expect(registerResponse.status).toBe(201);
  return registerResponse.json();
}

function mockOpenClaw(overrides: Partial<OpenClawChatPort> = {}): OpenClawChatPort {
  return {
    checkHealth: vi.fn(async () => ({ ok: true })),
    createChatCompletion: vi.fn(async ({ sessionKey }) => ({
      reply: "alive",
      model: "openclaw/default",
      sessionKey
    })),
    ...overrides
  };
}
