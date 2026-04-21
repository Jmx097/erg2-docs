import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { BridgeConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { createId } from "./ids.js";
import { logBridgeEvent } from "./logger.js";
import { buildMobileSessionKey, normalizeConversationId } from "./session-key.js";
import type { BridgeServices } from "./services.js";
import type { OpenClawChatPort } from "./server.js";

const NEWEST_CONNECTION_CLOSE_CODE = 4009;
const REVOKED_CLOSE_CODE = 4003;
const INVALID_TICKET_CLOSE_CODE = 4001;
const STALE_CONNECTION_CLOSE_CODE = 4011;
const SERVER_RESTART_CLOSE_CODE = 4010;

interface RelayConnection {
  ws: WebSocket;
  connectionId: string;
  deviceId: string;
  conversationId: string;
  accessExpiresAt: Date;
  remoteIp?: string;
  readySent: boolean;
  lastPongAtMs: number;
  heartbeatTimer: NodeJS.Timeout;
  expiringTimer?: NodeJS.Timeout;
}

export class RelayServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly activeConnections = new Map<string, RelayConnection>();
  private attachedServer?: HttpServer;
  private boundUpgradeHandler?: (request: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => void;

  constructor(
    private readonly config: Pick<BridgeConfig, "relayHeartbeatIntervalMs" | "relayPongTimeoutMs" | "relayStaleMissCount">,
    private readonly services: BridgeServices,
    private readonly openclaw: OpenClawChatPort
  ) {}

  attach(server: HttpServer): void {
    if (this.attachedServer) {
      throw new Error("RelayServer is already attached");
    }

    this.boundUpgradeHandler = (request, socket, head) => {
      if (!request.url) {
        socket.destroy();
        return;
      }

      const upgradeUrl = new URL(request.url, "http://127.0.0.1");
      if (upgradeUrl.pathname !== "/v1/relay/ws") {
        socket.destroy();
        return;
      }

      const ticket = upgradeUrl.searchParams.get("ticket");
      if (!ticket) {
        logBridgeEvent({
          event: "relay_upgrade_rejected",
          reason: "missing_ticket",
          remoteIp: request.socket.remoteAddress
        });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      void (async () => {
        let consumedTicket;
        try {
          consumedTicket = await this.services.consumeWebSocketTicket(ticket);
        } catch {
          logBridgeEvent({
            event: "relay_upgrade_rejected",
            reason: "invalid_ticket",
            remoteIp: request.socket.remoteAddress
          });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.bindConnection(ws, request, consumedTicket);
        });
      })();
    };

    server.on("upgrade", this.boundUpgradeHandler);
    this.attachedServer = server;
  }

  closeAll(reason: string = "server_restart"): void {
    for (const connection of this.activeConnections.values()) {
      connection.ws.close(SERVER_RESTART_CLOSE_CODE, reason);
      this.cleanupConnection(connection, SERVER_RESTART_CLOSE_CODE);
    }

    this.wss.close();

    if (this.attachedServer && this.boundUpgradeHandler) {
      this.attachedServer.off("upgrade", this.boundUpgradeHandler);
      this.attachedServer = undefined;
      this.boundUpgradeHandler = undefined;
    }
  }

  revokeDevice(deviceId: string, reason: string): void {
    const connection = this.activeConnections.get(deviceId);

    if (!connection) {
      return;
    }

    this.sendJson(connection, { type: "revoked", reason });
    connection.ws.close(REVOKED_CLOSE_CODE, reason);
    this.cleanupConnection(connection, REVOKED_CLOSE_CODE);
  }

  private bindConnection(
    ws: WebSocket,
    request: IncomingMessage,
    ticket: { deviceId: string; conversationId: string; accessExpiresAt: Date }
  ): void {
    const existing = this.activeConnections.get(ticket.deviceId);
    if (existing) {
      existing.ws.close(NEWEST_CONNECTION_CLOSE_CODE, "replaced_by_new_connection");
      this.cleanupConnection(existing, NEWEST_CONNECTION_CLOSE_CODE);
    }

    const connection: RelayConnection = {
      ws,
      connectionId: createId("con"),
      deviceId: ticket.deviceId,
      conversationId: ticket.conversationId,
      accessExpiresAt: ticket.accessExpiresAt,
      remoteIp: request.socket.remoteAddress,
      readySent: false,
      lastPongAtMs: Date.now(),
      heartbeatTimer: setInterval(() => {
        this.sendHeartbeat(connection);
      }, this.config.relayHeartbeatIntervalMs)
    };

    this.activeConnections.set(connection.deviceId, connection);
    logBridgeEvent({
      event: "relay_connected",
      connectionId: connection.connectionId,
      deviceId: connection.deviceId,
      conversationId: connection.conversationId,
      remoteIp: connection.remoteIp
    });
    void this.services.recordConnectionEvent({
      deviceId: connection.deviceId,
      connectionId: connection.connectionId,
      eventType: "connected",
      ip: connection.remoteIp
    }).catch(() => undefined);

    this.scheduleTokenExpiring(connection);

    ws.on("message", (raw: RawData) => {
      void this.onMessage(connection, String(raw));
    });

    ws.on("close", (code: number) => {
      this.cleanupConnection(connection, Number(code));
    });

    ws.on("error", () => {
      this.cleanupConnection(connection);
    });
  }

  private async onMessage(connection: RelayConnection, raw: string): Promise<void> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.sendJson(connection, {
        type: "error",
        code: "invalid_json",
        message: "Expected JSON websocket payload.",
        retryable: false
      });
      return;
    }

    const type = typeof parsed.type === "string" ? parsed.type : "";

    switch (type) {
      case "hello":
        this.handleHello(connection, parsed);
        return;
      case "resume":
        await this.handleResume(connection, parsed);
        return;
      case "pong":
        connection.lastPongAtMs = Date.now();
        return;
      case "prompt":
        await this.handlePrompt(connection, parsed);
        return;
      default:
        this.sendJson(connection, {
          type: "error",
          code: "unknown_message_type",
          message: "Unknown websocket message type.",
          retryable: false
        });
    }
  }

  private handleHello(connection: RelayConnection, payload: Record<string, unknown>): void {
    if (typeof payload.conversation_id === "string") {
      connection.conversationId = normalizeConversationId(payload.conversation_id);
    }

    this.sendReady(connection);
  }

  private async handleResume(connection: RelayConnection, payload: Record<string, unknown>): Promise<void> {
    if (typeof payload.conversation_id === "string") {
      connection.conversationId = normalizeConversationId(payload.conversation_id);
    }

    this.sendReady(connection);

    const pendingPromptId = typeof payload.pending_prompt_id === "string" ? payload.pending_prompt_id.trim() : "";
    if (!pendingPromptId) {
      return;
    }

    const existing = await this.services.getPromptResult(connection.deviceId, pendingPromptId);
    if (existing) {
      this.sendJson(connection, {
        type: "reply.final",
        event_id: createId("evt"),
        prompt_id: existing.promptId,
        text: existing.text,
        request_id: existing.requestId
      });
      return;
    }

    this.sendJson(connection, {
      type: "error",
      code: "prompt_interrupted",
      message: "The relay restarted before the final reply was persisted.",
      retryable: true,
      prompt_id: pendingPromptId
    });
  }

  private async handlePrompt(connection: RelayConnection, payload: Record<string, unknown>): Promise<void> {
    if (!connection.readySent) {
      this.sendJson(connection, {
        type: "error",
        code: "hello_required",
        message: "Send hello before prompt messages.",
        retryable: false
      });
      return;
    }

    const promptId = typeof payload.prompt_id === "string" ? payload.prompt_id.trim() : "";
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const conversationId = typeof payload.conversation_id === "string"
      ? normalizeConversationId(payload.conversation_id)
      : connection.conversationId;

    if (!promptId || !text) {
      this.sendJson(connection, {
        type: "error",
        code: "prompt_invalid",
        message: "Prompt messages require prompt_id and text.",
        retryable: false
      });
      return;
    }

    const existing = await this.services.getPromptResult(connection.deviceId, promptId);
    if (existing) {
      this.sendJson(connection, {
        type: "reply.final",
        event_id: createId("evt"),
        prompt_id: existing.promptId,
        text: existing.text,
        request_id: existing.requestId
      });
      return;
    }

    const requestId = createId("req");
    logBridgeEvent({
      event: "relay_prompt",
      connectionId: connection.connectionId,
      deviceId: connection.deviceId,
      conversationId,
      promptId,
      requestId
    });
    const result = await this.openclaw.createChatCompletion({
      requestId,
      sessionKey: buildMobileSessionKey(connection.deviceId, conversationId),
      prompt: text,
      messageChannel: "mobile",
      systemPrompt: "You are OpenClaw replying to a mobile companion for Even Realities G2 glasses. Keep replies concise, practical, and easy to render on a small HUD."
    });

    await this.services.markPromptResult({
      deviceId: connection.deviceId,
      promptId,
      conversationId,
      requestId,
      text: result.reply
    });

    this.sendJson(connection, {
      type: "reply.delta",
      event_id: createId("evt"),
      prompt_id: promptId,
      delta: result.reply
    });

    this.sendJson(connection, {
      type: "reply.final",
      event_id: createId("evt"),
      prompt_id: promptId,
      text: result.reply,
      request_id: requestId
    });
  }

  private sendReady(connection: RelayConnection): void {
    if (connection.readySent) {
      return;
    }

    connection.readySent = true;
    this.sendJson(connection, {
      type: "ready",
      connection_id: connection.connectionId,
      heartbeat_interval_seconds: Math.round(this.config.relayHeartbeatIntervalMs / 1000),
      pong_timeout_seconds: Math.round(this.config.relayPongTimeoutMs / 1000),
      access_token_expires_at: connection.accessExpiresAt.toISOString()
    });
  }

  private sendHeartbeat(connection: RelayConnection): void {
    const nowMs = Date.now();
    const staleAfterMs =
      this.config.relayHeartbeatIntervalMs * this.config.relayStaleMissCount + this.config.relayPongTimeoutMs;

    if (nowMs - connection.lastPongAtMs > staleAfterMs) {
      connection.ws.close(STALE_CONNECTION_CLOSE_CODE, "stale_connection");
      this.cleanupConnection(connection, STALE_CONNECTION_CLOSE_CODE);
      return;
    }

    this.sendJson(connection, {
      type: "ping",
      ping_id: createId("png")
    });
  }

  private scheduleTokenExpiring(connection: RelayConnection): void {
    const msUntilExpiringNotice = connection.accessExpiresAt.getTime() - Date.now() - 60_000;
    if (msUntilExpiringNotice <= 0) {
      this.sendJson(connection, {
        type: "token.expiring",
        expires_at: connection.accessExpiresAt.toISOString()
      });
      return;
    }

    connection.expiringTimer = setTimeout(() => {
      this.sendJson(connection, {
        type: "token.expiring",
        expires_at: connection.accessExpiresAt.toISOString()
      });
    }, msUntilExpiringNotice);
  }

  private sendJson(connection: RelayConnection, payload: Record<string, unknown>): void {
    if (connection.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    connection.ws.send(JSON.stringify(payload));
  }

  private cleanupConnection(connection: RelayConnection, closeCode?: number): void {
    clearInterval(connection.heartbeatTimer);
    if (connection.expiringTimer) {
      clearTimeout(connection.expiringTimer);
    }

    if (this.activeConnections.get(connection.deviceId)?.connectionId === connection.connectionId) {
      this.activeConnections.delete(connection.deviceId);
      logBridgeEvent({
        event: "relay_closed",
        connectionId: connection.connectionId,
        deviceId: connection.deviceId,
        conversationId: connection.conversationId,
        remoteIp: connection.remoteIp,
        closeCode
      });
      void this.services.recordConnectionEvent({
        deviceId: connection.deviceId,
        connectionId: connection.connectionId,
        eventType: closeCode === REVOKED_CLOSE_CODE ? "revoked" : "closed",
        ip: connection.remoteIp,
        closeCode
      }).catch(() => undefined);
    }
  }
}

export function relayCloseCodeForApiError(error: unknown): number {
  return error instanceof ApiError && error.code === "invalid_ticket" ? INVALID_TICKET_CLOSE_CODE : SERVER_RESTART_CLOSE_CODE;
}
