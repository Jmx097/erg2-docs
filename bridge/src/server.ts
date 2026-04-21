import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { ClientType } from "@openclaw/protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { parseBearerToken, requireBearerToken } from "./auth.js";
import type { BridgeConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { ApiError, isApiError } from "./errors.js";
import { createId } from "./ids.js";
import { logBridgeEvent } from "./logger.js";
import {
  G2_HUD_SYSTEM_PROMPT,
  OpenClawClient,
  buildG2SessionKey,
  getFailureKind,
  normalizeInstallId,
  publicErrorMessage
} from "./openclaw.js";
import { PostgresBridgeStore } from "./postgres-store.js";
import { RelayServer } from "./relay.js";
import { InMemoryRateLimiter } from "./rate-limit.js";
import { buildMobileSessionKey, normalizeConversationId } from "./session-key.js";
import { BridgeServices } from "./services.js";
import type { BridgeStore } from "./store.js";

export interface TurnBody {
  installId?: unknown;
  prompt?: unknown;
}

export interface TurnSuccessResponse {
  reply: string;
  model: string;
  sessionKey: string;
  requestId: string;
}

export interface TurnErrorResponse {
  error: string;
  requestId: string;
  failureKind?: string;
}

export interface OpenClawChatPort {
  checkHealth(): Promise<unknown>;
  createChatCompletion(input: {
    requestId: string;
    sessionKey: string;
    prompt: string;
    messageChannel?: string;
    systemPrompt?: string;
  }): Promise<{
    reply: string;
    model: string;
    sessionKey: string;
  }>;
}

export interface BridgeRuntime {
  services: BridgeServices;
  openclaw: OpenClawChatPort;
  relay: RelayServer;
  rateLimiter: InMemoryRateLimiter;
}

interface BridgeContextVariables {
  Variables: {
    requestId: string;
    deviceId?: string;
  };
}

export interface StartedBridgeServer {
  app: Hono<BridgeContextVariables>;
  config: BridgeConfig;
  runtime: BridgeRuntime;
  server: HttpServer;
  port: number;
  close(): Promise<void>;
}

export function createBridgeRuntime(
  config: BridgeConfig,
  openclaw: OpenClawChatPort = new OpenClawClient(config),
  store?: BridgeStore
): BridgeRuntime {
  const services = new BridgeServices(config, store);

  return {
    services,
    openclaw,
    relay: new RelayServer(config, services, openclaw),
    rateLimiter: new InMemoryRateLimiter()
  };
}

export async function createConfiguredBridgeRuntime(
  config: BridgeConfig,
  openclaw: OpenClawChatPort = new OpenClawClient(config)
): Promise<BridgeRuntime> {
  const store = config.bridgeStoreDriver === "postgres" ? await PostgresBridgeStore.create(config) : undefined;
  return createBridgeRuntime(config, openclaw, store);
}

export function createBridgeApp(config: BridgeConfig, runtime?: BridgeRuntime): Hono<BridgeContextVariables> {
  if (!runtime && config.bridgeStoreDriver === "postgres") {
    throw new Error("Postgres bridge runtime must be created with createConfiguredBridgeRuntime(config).");
  }

  const resolvedRuntime = runtime ?? createBridgeRuntime(config);
  const app = new Hono<BridgeContextVariables>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600
    })
  );

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.trim() || createId("req");
    const startedAtMs = Date.now();

    c.set("requestId", requestId);

    await next();

    c.header("x-request-id", requestId);
    logBridgeEvent({
      event: "http_request",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      elapsedMs: Date.now() - startedAtMs,
      remoteIp: clientIp(c),
      deviceId: c.get("deviceId")
    });
  });

  if (config.g2BridgeToken) {
    app.use("/health", requireBearerToken(config.g2BridgeToken));
    app.use("/v0/*", requireBearerToken(config.g2BridgeToken));
  }

  app.get("/health", async (c) => {
    if (!config.g2BridgeToken) {
      return c.json({ error: "legacy_g2_bridge_disabled" }, 404);
    }

    const gateway = config.openclawHealthCheck ? await resolvedRuntime.openclaw.checkHealth() : { skipped: true };
    return c.json({
      ok: true,
      bridge: "g2-openclaw-bridge",
      gateway
    });
  });

  app.post("/v0/turn", async (c) => {
    if (!config.g2BridgeToken) {
      return c.json({ error: "legacy_g2_bridge_disabled" }, 404);
    }

    const body = await readJsonBody(c.req.raw);
    const validated = validateTurnBody(body);

    if (!validated.ok) {
      return c.json({ error: validated.error }, 400);
    }

    const sessionKey = buildG2SessionKey(validated.installId);
    const requestId = createId("turn");

    try {
      const result = await resolvedRuntime.openclaw.createChatCompletion({
        requestId,
        sessionKey,
        prompt: validated.prompt
      });

      return c.json({
        reply: sanitizeHudText(result.reply),
        model: result.model,
        sessionKey: result.sessionKey,
        requestId
      });
    } catch (error) {
      const failureKind = getFailureKind(error);

      return c.json(
        {
          error: publicErrorMessage(error),
          requestId,
          ...(failureKind ? { failureKind } : {})
        },
        502
      );
    }
  });

  app.get("/v1/health", async (c) => {
    const gateway = config.openclawHealthCheck ? await resolvedRuntime.openclaw.checkHealth() : { skipped: true };
    return c.json({
      ok: true,
      bridge: "openclaw-mobile-companion",
      websocket: true,
      gateway
    });
  });

  app.get("/v1/ready", async (c) => {
    const gateway = await resolvedRuntime.openclaw.checkHealth();
    const readiness = await resolvedRuntime.services.checkReadiness(isGatewayHealthy(gateway));
    return c.json(readiness, readiness.ready ? 200 : 503);
  });

  app.post("/v1/turn", async (c) => {
    let requestId = c.get("requestId");

    try {
      enforceRateLimit(c, resolvedRuntime.rateLimiter, "turn", 30, 60_000);
      const accessToken = requireAuthorizationBearer(c);
      const verified = await resolvedRuntime.services.verifyAccessToken(accessToken, ["turn:send"]);
      c.set("deviceId", verified.deviceId);
      const body = await readJsonBody(c.req.raw);
      const validated = validateV1TurnBody(body);

      if (!validated.ok) {
        return c.json({ error: validated.error }, 400);
      }

      const existing = await resolvedRuntime.services.getPromptResult(verified.deviceId, validated.promptId);
      if (existing) {
        return c.json(
          {
            reply: sanitizeHudText(existing.text),
            request_id: existing.requestId,
            conversation_id: existing.conversationId
          },
          200
        );
      }

      const result = await resolvedRuntime.openclaw.createChatCompletion({
        requestId,
        sessionKey: buildMobileSessionKey(verified.deviceId, validated.conversationId),
        prompt: validated.text,
        messageChannel: "g2",
        systemPrompt: G2_HUD_SYSTEM_PROMPT
      });
      const reply = sanitizeHudText(result.reply);
      await resolvedRuntime.services.markPromptResult({
        deviceId: verified.deviceId,
        promptId: validated.promptId,
        conversationId: validated.conversationId,
        requestId,
        text: reply
      });
      await resolvedRuntime.services.touchDevice(verified.deviceId, new Date(), { remoteIp: clientIp(c) });

      return c.json(
        {
          reply,
          request_id: requestId,
          conversation_id: validated.conversationId
        },
        200
      );
    } catch (error) {
      if (isApiError(error)) {
        return handleError(c, error);
      }

      const failureKind = getFailureKind(error);

      return c.json(
        {
          error: publicErrorMessage(error),
          request_id: requestId,
          ...(failureKind ? { failure_kind: failureKind } : {})
        },
        502
      );
    }
  });

  app.get("/v1/relay/ws", (c) => c.json({ error: "upgrade_required" }, 426));

  app.post("/v1/pairing/sessions", async (c) => {
    try {
      requireAdmin(c, config);
      const body = await readJsonBody(c.req.raw);
      const bodyObject = typeof body === "object" && body !== null ? body : {};
      const pairing = await resolvedRuntime.services.createPairingSession({
        createdBy: "admin",
        platform: typeof bodyObject.platform === "string" ? bodyObject.platform : undefined,
        deviceDisplayNameHint:
          typeof bodyObject.device_display_name_hint === "string" ? bodyObject.device_display_name_hint : undefined
      });
      return c.json(pairing, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/pairing/redeem", async (c) => {
    try {
      enforceRateLimit(c, resolvedRuntime.rateLimiter, "pairing", 5, 60_000);
      const body = await readJsonBody(c.req.raw);
      const pairingCode = typeof body?.pairing_code === "string" ? body.pairing_code : "";
      const pairingSessionId = typeof body?.pairing_session_id === "string" ? body.pairing_session_id : undefined;
      const redeemed = await resolvedRuntime.services.redeemPairingCode(pairingCode, pairingSessionId);
      return c.json(redeemed, 200);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/devices/register", async (c) => {
    try {
      const bootstrapToken = requireAuthorizationBearer(c);
      const body = await readJsonBody(c.req.raw);
      const bodyObject = typeof body === "object" && body !== null ? body : {};
      const result = await resolvedRuntime.services.registerDevice({
        bootstrapToken,
        deviceDisplayName: typeof bodyObject.device_display_name === "string" ? bodyObject.device_display_name : undefined,
        platform: typeof bodyObject.platform === "string" ? bodyObject.platform : undefined,
        appVersion: typeof bodyObject.app_version === "string" ? bodyObject.app_version : undefined,
        clientType: readClientType(bodyObject.client_type),
        remoteIp: clientIp(c)
      });
      c.set("deviceId", result.device_id);
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/auth/refresh", async (c) => {
    try {
      enforceRateLimit(c, resolvedRuntime.rateLimiter, "refresh", 30, 60_000);
      const body = await readJsonBody(c.req.raw);
      const bodyObject = typeof body === "object" && body !== null ? body : {};
      const deviceId = typeof bodyObject.device_id === "string" ? bodyObject.device_id : "";
      const refreshToken = typeof bodyObject.refresh_token === "string" ? bodyObject.refresh_token : "";

      if (!deviceId || !refreshToken) {
        throw new ApiError("device_id and refresh_token are required.", 400, "refresh_invalid_request");
      }

      const result = await resolvedRuntime.services.refreshSession({
        deviceId,
        refreshToken,
        remoteIp: clientIp(c)
      });
      c.set("deviceId", deviceId);
      return c.json(result, 200);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/auth/ws-ticket", async (c) => {
    try {
      enforceRateLimit(c, resolvedRuntime.rateLimiter, "ws-ticket", 20, 60_000);
      const accessToken = requireAuthorizationBearer(c);
      const body = await readJsonBody(c.req.raw);
      const bodyObject = typeof body === "object" && body !== null ? body : {};
      const result = await resolvedRuntime.services.issueWebSocketTicket({
        accessToken,
        conversationId: typeof bodyObject.conversation_id === "string" ? bodyObject.conversation_id : undefined
      });
      const verified = await resolvedRuntime.services.verifyAccessToken(accessToken, ["relay:connect"]);
      c.set("deviceId", verified.deviceId);
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/v1/devices", async (c) => {
    try {
      requireAdmin(c, config);
      return c.json(await resolvedRuntime.services.listDevices(), 200);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/devices/:deviceId/revoke", async (c) => {
    try {
      requireAdmin(c, config);
      const body = await readJsonBody(c.req.raw);
      const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "operator_requested";
      const result = await resolvedRuntime.services.revokeDevice({
        deviceId: c.req.param("deviceId"),
        reason,
        createdBy: "admin"
      });
      resolvedRuntime.relay.revokeDevice(result.device_id, reason);
      return c.json(result, 200);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}

export async function startBridgeServer(
  config: BridgeConfig = loadConfig(),
  runtime?: BridgeRuntime,
  options: { port?: number } = {}
): Promise<StartedBridgeServer> {
  const resolvedRuntime = runtime ?? (await createConfiguredBridgeRuntime(config));
  const cleanupTimer = setInterval(() => {
    void resolvedRuntime.services.cleanupExpiredState().catch((error) => {
      logBridgeEvent({
        event: "bridge_cleanup_failed",
        error: publicErrorMessage(error)
      });
    });
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  try {
    await assertStartupReady(config, resolvedRuntime);
  } catch (error) {
    clearInterval(cleanupTimer);
    await resolvedRuntime.services.close();
    throw error;
  }

  const app = createBridgeApp(config, resolvedRuntime);
  const server = createServer(getRequestListener(app.fetch));
  resolvedRuntime.relay.attach(server);

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? config.port, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : config.port;
  console.log(`OpenClaw mobile companion bridge listening on http://127.0.0.1:${resolvedPort}`);

  return {
    app,
    config,
    runtime: resolvedRuntime,
    server,
    port: resolvedPort,
    async close() {
      clearInterval(cleanupTimer);
      resolvedRuntime.relay.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await resolvedRuntime.services.close();
    }
  };
}

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validateTurnBody(body: TurnBody | null):
  | { ok: true; installId: string; prompt: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected JSON body" };
  }

  if (typeof body.installId !== "string") {
    return { ok: false, error: "installId is required" };
  }

  const installId = normalizeInstallId(body.installId);
  if (installId.length < 4) {
    return { ok: false, error: "installId is too short" };
  }

  if (typeof body.prompt !== "string") {
    return { ok: false, error: "prompt is required" };
  }

  const prompt = body.prompt.trim();
  if (!prompt) {
    return { ok: false, error: "prompt is empty" };
  }

  if (prompt.length > 2_000) {
    return { ok: false, error: "prompt is too long" };
  }

  return { ok: true, installId, prompt };
}

function validateV1TurnBody(body: unknown):
  | { ok: true; conversationId: string; promptId: string; text: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected JSON body" };
  }

  const bodyObject = body as Record<string, unknown>;
  const conversationId = normalizeConversationId(typeof bodyObject.conversation_id === "string" ? bodyObject.conversation_id : "");
  const promptId = typeof bodyObject.prompt_id === "string" ? bodyObject.prompt_id.trim() : "";
  const text = typeof bodyObject.text === "string" ? bodyObject.text.trim() : "";

  if (!promptId) {
    return { ok: false, error: "prompt_id is required" };
  }

  if (!text) {
    return { ok: false, error: "text is required" };
  }

  if (text.length > 2_000) {
    return { ok: false, error: "text is too long" };
  }

  return { ok: true, conversationId, promptId: promptId.slice(0, 128), text };
}

function sanitizeHudText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2_000);
}

function requireAuthorizationBearer(c: Context): string {
  const token = parseBearerToken(c.req.header("authorization") ?? "");
  if (!token) {
    throw new ApiError("Bearer token is required.", 401, "authorization_required");
  }
  return token;
}

function requireAdmin(c: Context, config: BridgeConfig): void {
  const token = requireAuthorizationBearer(c);
  if (token !== config.adminApiToken) {
    throw new ApiError("Administrator authorization required.", 401, "admin_unauthorized");
  }
}

function enforceRateLimit(
  c: Context,
  rateLimiter: InMemoryRateLimiter,
  routeKey: string,
  limit: number,
  windowMs: number
): void {
  const key = `${routeKey}:${clientIp(c)}`;
  const result = rateLimiter.check(key, limit, windowMs);

  if (!result.allowed) {
    throw new ApiError("Too many requests. Try again shortly.", 429, "rate_limited", {
      retry_after_ms: result.retryAfterMs
    });
  }
}

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

function handleError(c: Context, error: unknown): Response {
  if (isApiError(error)) {
    return c.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {})
      },
      error.status as any
    );
  }

  return c.json({ error: publicErrorMessage(error) }, 500);
}

function readClientType(value: unknown): ClientType | undefined {
  return value === "even_hub" ? "even_hub" : undefined;
}

async function assertStartupReady(config: BridgeConfig, runtime: BridgeRuntime): Promise<void> {
  if (config.environment === "production" && config.bridgeStoreDriver !== "postgres") {
    throw new Error("Production requires BRIDGE_STORE_DRIVER=postgres.");
  }

  if (!config.startupRequireReady) {
    return;
  }

  const gateway = await runtime.openclaw.checkHealth();
  const readiness = await runtime.services.checkReadiness(isGatewayHealthy(gateway));

  if (!readiness.ready) {
    throw new Error(`Bridge startup readiness failed: ${JSON.stringify(readiness)}`);
  }
}

function isGatewayHealthy(value: unknown): boolean {
  return Boolean(typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startBridgeServer();
}
