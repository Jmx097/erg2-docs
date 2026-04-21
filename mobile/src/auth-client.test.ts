import { describe, expect, it, vi } from "vitest";
import { MobileAuthClient } from "./auth-client.js";

describe("MobileAuthClient", () => {
  it("sends pairing redemption with the session id when present", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(
        JSON.stringify({
          bootstrap_token: "btp_123",
          bootstrap_expires_at: "2026-04-21T01:00:00.000Z",
          pairing_session_id: "ps_123"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = new MobileAuthClient(fetchImpl);

    const result = await client.redeemPairing("https://api.example.com", {
      pairing_session_id: "ps_123",
      pairing_code: "ABCD-1234"
    });

    expect(result.pairing_session_id).toBe("ps_123");
    const [, init] = calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      pairing_session_id: "ps_123",
      pairing_code: "ABCD-1234"
    });
  });
});
