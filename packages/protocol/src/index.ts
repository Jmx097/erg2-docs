export type ClientType = "mobile" | "even_hub";

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface BridgeHealthResponse {
  ok: boolean;
  bridge: string;
  websocket?: boolean;
  gateway?: unknown;
}

export interface BridgeReadyResponse {
  ok: boolean;
  ready: boolean;
  bridge: string;
  storage: "memory" | "postgres";
  checks: {
    database: boolean;
    openclaw: boolean;
  };
}

export interface CreatePairingSessionRequest {
  platform?: string;
  device_display_name_hint?: string;
}

export interface PairingSessionResponse {
  pairing_session_id: string;
  pairing_code: string;
  relay_base_url: string;
  expires_at: string;
  qr_payload: string;
}

export interface RedeemPairingRequest {
  pairing_session_id?: string;
  pairing_code: string;
}

export interface RedeemPairingResponse {
  bootstrap_token: string;
  bootstrap_expires_at: string;
  pairing_session_id: string;
}

export interface RegisterDeviceRequest {
  device_display_name?: string;
  platform?: string;
  app_version?: string;
  client_type?: ClientType;
}

export interface RegisterDeviceResponse {
  device_id: string;
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  refresh_family_id: string;
  default_conversation_id: string;
  client_type: ClientType;
}

export interface RefreshSessionRequest {
  device_id: string;
  refresh_token: string;
}

export interface RefreshSessionResponse {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  refresh_family_id: string;
  client_type: ClientType;
}

export interface IssueWebSocketTicketRequest {
  conversation_id?: string;
}

export interface WebSocketTicketResponse {
  ticket: string;
  expires_at: string;
  ws_url: string;
}

export interface HelloMessage {
  type: "hello";
  conversation_id: string;
  client_instance_id?: string;
  app_state?: "foreground" | "background";
  last_event_id?: string;
}

export interface PromptMessage {
  type: "prompt";
  conversation_id: string;
  prompt_id: string;
  text: string;
}

export interface PongMessage {
  type: "pong";
  ping_id: string;
}

export interface ResumeMessage {
  type: "resume";
  conversation_id: string;
  last_event_id?: string;
  pending_prompt_id?: string;
}

export type RelayClientMessage = HelloMessage | PromptMessage | PongMessage | ResumeMessage;

export interface ReadyMessage {
  type: "ready";
  connection_id: string;
  heartbeat_interval_seconds: number;
  pong_timeout_seconds: number;
  access_token_expires_at: string;
}

export interface ReplyDeltaMessage {
  type: "reply.delta";
  event_id: string;
  prompt_id: string;
  delta: string;
}

export interface ReplyFinalMessage {
  type: "reply.final";
  event_id: string;
  prompt_id: string;
  text: string;
  request_id: string;
}

export interface RelayErrorMessage {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
  prompt_id?: string;
}

export interface PingMessage {
  type: "ping";
  ping_id: string;
}

export interface TokenExpiringMessage {
  type: "token.expiring";
  expires_at: string;
}

export interface RevokedMessage {
  type: "revoked";
  reason: string;
}

export type RelayServerMessage =
  | ReadyMessage
  | ReplyDeltaMessage
  | ReplyFinalMessage
  | RelayErrorMessage
  | PingMessage
  | TokenExpiringMessage
  | RevokedMessage;

export interface TurnRequest {
  conversation_id: string;
  prompt_id: string;
  text: string;
}

export interface TurnResponse {
  reply: string;
  request_id: string;
  conversation_id: string;
}

export interface DeviceSummary {
  device_id: string;
  device_display_name: string;
  platform: string;
  status: string;
  client_type: ClientType;
  last_seen_at?: string;
}

export interface ListDevicesResponse {
  devices: DeviceSummary[];
}

export interface RevokeDeviceRequest {
  reason?: string;
}

export interface RevokeDeviceResponse {
  device_id: string;
  status: "revoked";
  revoked_at: string;
  disconnect_active_sessions: true;
}
