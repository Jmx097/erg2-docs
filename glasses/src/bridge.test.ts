import { describe, expect, it, vi } from "vitest";
import { BridgeClient, normalizeRelayBaseUrl } from "./bridge.js";

describe("BridgeClient", () => {
  it("calls the v1 turn endpoint with the short-lived access token", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(
        JSON.stringify({ reply: "alive", request_id: "req_1234abcd", conversation_id: "default" }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    const client = new BridgeClient(fetchImpl);

    const result = await client.sendTurn(
      "wss://bridge.example.com/",
      "access-token",
      {
        conversation_id: "default",
        prompt_id: "prm_123",
        text: "ping"
      }
    );

    expect(result.reply).toBe("alive");
    const [url, init] = calls[0]!;
    expect(url).toBe("https://bridge.example.com/v1/turn");
    expect(init?.headers).toMatchObject({ authorization: "Bearer access-token" });
  });

  it("calls the legacy v0 turn endpoint with the configured bridge token", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(
        JSON.stringify({ reply: "alive", requestId: "turn_legacy", model: "openclaw/default", sessionKey: "g2:inst_1" }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    const client = new BridgeClient(fetchImpl);

    const result = await client.sendLegacyTurn("https://bridge.example.com/", "bridge-token", {
      installId: "inst_123",
      prompt: "ping"
    });

    expect(result.reply).toBe("alive");
    const [url, init] = calls[0]!;
    expect(url).toBe("https://bridge.example.com/v0/turn");
    expect(init?.headers).toMatchObject({ authorization: "Bearer bridge-token" });
  });

  it("preserves typed API errors for repair and reconnect flows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "Device session has been revoked.",
          code: "device_revoked"
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" }
        }
      )
    );
    const client = new BridgeClient(fetchImpl);

    await expect(client.health("https://bridge.example.com")).rejects.toMatchObject({
      name: "BridgeApiError",
      message: "Device session has been revoked.",
      status: 401,
      code: "device_revoked"
    });
  });

  it("normalizes websocket-style relay URLs for HTTP requests", () => {
    expect(normalizeRelayBaseUrl("wss://bridge.example.com/")).toBe("https://bridge.example.com");
    expect(normalizeRelayBaseUrl("http://192.168.1.8:8787/")).toBe("http://192.168.1.8:8787");
  });
});
