import type {
  HelloMessage,
  PingMessage,
  PongMessage,
  PromptMessage,
  ReadyMessage,
  RelayClientMessage,
  RelayServerMessage,
  ResumeMessage,
  RevokedMessage,
  TokenExpiringMessage,
  WebSocketTicketResponse
} from "@openclaw/protocol";
import { calculateReconnectDelayMs, DEFAULT_RECONNECT_POLICY, type ReconnectPolicy } from "./reconnect.js";

export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => SocketLike;

export interface SessionState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "closed";
  connectionId?: string;
  accessTokenExpiresAt?: string;
  lastEventId?: string;
}

export interface RelaySessionOptions {
  websocketFactory: WebSocketFactory;
  reconnectPolicy?: ReconnectPolicy;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  random?: () => number;
}

export class RelayWebSocketSession {
  private readonly reconnectPolicy: ReconnectPolicy;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly random: () => number;
  private socket: SocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastTicket: WebSocketTicketResponse | null = null;
  private lastConversationId = "default";
  private pendingPromptId?: string;
  private lastEventId?: string;
  private lastServerMessage?: RelayServerMessage;
  private state: SessionState = { status: "idle" };
  private readonly stateListeners = new Set<(state: SessionState) => void>();
  private readonly messageListeners = new Set<(message: RelayServerMessage) => void>();

  constructor(private readonly options: RelaySessionOptions) {
    this.reconnectPolicy = options.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    this.random = options.random ?? Math.random;
  }

  getState(): SessionState {
    return { ...this.state };
  }

  getLastServerMessage(): RelayServerMessage | undefined {
    return this.lastServerMessage;
  }

  subscribeState(listener: (state: SessionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeMessage(listener: (message: RelayServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  connect(ticket: WebSocketTicketResponse, conversationId: string, lastEventId?: string, pendingPromptId?: string): void {
    this.clearReconnectTimer();
    this.lastTicket = ticket;
    this.lastConversationId = conversationId;
    this.lastEventId = lastEventId;
    this.pendingPromptId = pendingPromptId;
    this.setState({ status: "connecting", lastEventId });

    const socket = this.options.websocketFactory(ticket.ws_url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      const message: HelloMessage | ResumeMessage =
        lastEventId || pendingPromptId
          ? {
              type: "resume",
              conversation_id: conversationId,
              ...(lastEventId ? { last_event_id: lastEventId } : {}),
              ...(pendingPromptId ? { pending_prompt_id: pendingPromptId } : {})
            }
          : {
              type: "hello",
              conversation_id: conversationId,
              app_state: "foreground"
            };
      this.send(message);
    };

    socket.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RelayServerMessage;
      this.lastServerMessage = parsed;
      this.emitMessage(parsed);

      switch (parsed.type) {
        case "ready":
          this.setState({
            status: "connected",
            connectionId: parsed.connection_id,
            accessTokenExpiresAt: parsed.access_token_expires_at,
            lastEventId: this.lastEventId
          });
          return;
        case "reply.delta":
        case "reply.final":
          this.lastEventId = parsed.event_id;
          this.setState({ ...this.state, lastEventId: parsed.event_id });
          if (parsed.type === "reply.final" && parsed.prompt_id === this.pendingPromptId) {
            this.pendingPromptId = undefined;
          }
          return;
        case "ping":
          this.send({
            type: "pong",
            ping_id: parsed.ping_id
          } satisfies PongMessage);
          return;
        case "token.expiring":
        case "revoked":
        case "error":
          return;
      }
    };

    socket.onclose = (event) => {
      this.socket = null;
      this.setState({ status: "closed", lastEventId: this.lastEventId });

      if (isReconnectableCloseCode(event.code) && this.lastTicket) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      if (this.socket) {
        this.socket.close(4010, "socket_error");
      }
    };
  }

  disconnect(code = 1000, reason = "client_disconnect"): void {
    this.clearReconnectTimer();
    this.socket?.close(code, reason);
    this.socket = null;
    this.setState({ status: "closed", lastEventId: this.lastEventId });
  }

  replaceTicket(ticket: WebSocketTicketResponse): void {
    this.lastTicket = ticket;
  }

  sendPrompt(promptId: string, text: string): void {
    this.pendingPromptId = promptId;
    this.send({
      type: "prompt",
      conversation_id: this.lastConversationId,
      prompt_id: promptId,
      text
    } satisfies PromptMessage);
  }

  handleNetworkRecovered(): number | null {
    if (!this.lastTicket) {
      return null;
    }

    return this.scheduleReconnect();
  }

  private send(message: RelayClientMessage): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("WebSocket is not open.");
    }

    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): number {
    this.clearReconnectTimer();
    const delayMs = calculateReconnectDelayMs(this.reconnectAttempt, this.reconnectPolicy, this.random);
    this.reconnectAttempt += 1;
    this.setState({ status: "reconnecting", lastEventId: this.lastEventId });
    this.reconnectTimer = this.setTimeoutImpl(() => {
      if (!this.lastTicket) {
        return;
      }

      this.connect(this.lastTicket, this.lastConversationId, this.lastEventId, this.pendingPromptId);
    }, delayMs);
    return delayMs;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.clearTimeoutImpl(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: SessionState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(this.getState());
    }
  }

  private emitMessage(message: RelayServerMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

function isReconnectableCloseCode(code: number): boolean {
  return ![4001, 4003].includes(code);
}

export function isRevokedMessage(message: RelayServerMessage | undefined): message is RevokedMessage {
  return message?.type === "revoked";
}

export function isTokenExpiringMessage(message: RelayServerMessage | undefined): message is TokenExpiringMessage {
  return message?.type === "token.expiring";
}

export function isPingMessage(message: RelayServerMessage | undefined): message is PingMessage {
  return message?.type === "ping";
}

export function isReadyMessage(message: RelayServerMessage | undefined): message is ReadyMessage {
  return message?.type === "ready";
}
