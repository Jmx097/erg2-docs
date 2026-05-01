import type {
  ApiErrorResponse,
  BridgeHealthResponse,
  RedeemPairingResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  TurnRequest,
  TurnResponse
} from "@openclaw/protocol";

export type FetchLike = typeof fetch;

interface LegacyTurnRequest {
  installId: string;
  prompt: string;
}

interface LegacyTurnResponse {
  reply: string;
  model: string;
  sessionKey: string;
  requestId: string;
}

export class BridgeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BridgeApiError";
  }
}

export class BridgeClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async health(baseUrl: string, signal?: AbortSignal): Promise<BridgeHealthResponse> {
    const response = await this.fetchJson<BridgeHealthResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/health`, {
      method: "GET",
      signal
    });

    if (!response.ok) {
      throw new Error("Bridge health check failed");
    }

    return response;
  }

  async legacyHealth(baseUrl: string, bridgeToken: string, signal?: AbortSignal): Promise<BridgeHealthResponse> {
    const response = await this.fetchJson<BridgeHealthResponse>(`${normalizeRelayBaseUrl(baseUrl)}/health`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${bridgeToken}`
      },
      signal
    });

    if (!response.ok) {
      throw new Error("Bridge health check failed");
    }

    return response;
  }

  async redeemPairing(baseUrl: string, pairingCode: string, signal?: AbortSignal): Promise<RedeemPairingResponse> {
    return this.fetchJson<RedeemPairingResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/pairing/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_code: pairingCode }),
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

  async sendTurn(baseUrl: string, accessToken: string, input: TurnRequest, signal?: AbortSignal): Promise<TurnResponse> {
    return this.fetchJson<TurnResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v1/turn`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input),
      signal
    });
  }

  async sendLegacyTurn(
    baseUrl: string,
    bridgeToken: string,
    input: LegacyTurnRequest,
    signal?: AbortSignal
  ): Promise<LegacyTurnResponse> {
    return this.fetchJson<LegacyTurnResponse>(`${normalizeRelayBaseUrl(baseUrl)}/v0/turn`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridgeToken}`,
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
      throw new BridgeApiError(
        errorPayload?.error || `Bridge returned ${response.status}`,
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
