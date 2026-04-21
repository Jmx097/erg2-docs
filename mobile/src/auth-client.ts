import type {
  ApiErrorResponse,
  BridgeHealthResponse,
  BridgeReadyResponse,
  IssueWebSocketTicketRequest,
  RedeemPairingRequest,
  RedeemPairingResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  WebSocketTicketResponse
} from "@openclaw/protocol";

export type FetchLike = typeof fetch;

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class MobileAuthClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async health(baseUrl: string, signal?: AbortSignal): Promise<BridgeHealthResponse> {
    return this.fetchJson<BridgeHealthResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/health`, {
      method: "GET",
      signal
    });
  }

  async ready(baseUrl: string, signal?: AbortSignal): Promise<BridgeReadyResponse> {
    return this.fetchJson<BridgeReadyResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/ready`, {
      method: "GET",
      signal
    });
  }

  async redeemPairing(baseUrl: string, input: RedeemPairingRequest, signal?: AbortSignal): Promise<RedeemPairingResponse> {
    return this.fetchJson<RedeemPairingResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/pairing/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal
    });
  }

  async registerDevice(
    baseUrl: string,
    bootstrapToken: string,
    input: RegisterDeviceRequest,
    signal?: AbortSignal
  ): Promise<RegisterDeviceResponse> {
    return this.fetchJson<RegisterDeviceResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/devices/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input),
      signal
    });
  }

  async refreshSession(
    baseUrl: string,
    input: RefreshSessionRequest,
    signal?: AbortSignal
  ): Promise<RefreshSessionResponse> {
    return this.fetchJson<RefreshSessionResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal
    });
  }

  async issueWebSocketTicket(
    baseUrl: string,
    accessToken: string,
    input: IssueWebSocketTicketRequest,
    signal?: AbortSignal
  ): Promise<WebSocketTicketResponse> {
    return this.fetchJson<WebSocketTicketResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/auth/ws-ticket`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input),
      signal
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, init);
    const json = (await response.json().catch(() => null)) as T | ApiErrorResponse | null;

    if (!response.ok) {
      const errorPayload = isApiErrorResponse(json) ? json : null;
      throw new MobileApiError(
        errorPayload?.error || `Relay returned ${response.status}`,
        response.status,
        errorPayload?.code,
        errorPayload?.details
      );
    }

    return json as T;
  }
}

export function normalizeRelayBaseUrl(value: string): string {
  return value.trim().replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://").replace(/\/+$/, "");
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}
