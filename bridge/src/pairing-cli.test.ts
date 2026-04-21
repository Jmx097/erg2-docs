import { describe, expect, it } from "vitest";
import { formatPairingSessionOutput } from "./pairing-cli.js";

describe("pairing cli", () => {
  it("prints the pairing session details in an operator-friendly layout", () => {
    const output = formatPairingSessionOutput({
      pairing_session_id: "ps_123",
      pairing_code: "ABCD-2345",
      expires_at: "2026-04-20T12:00:00.000Z",
      relay_base_url: "https://relay.example.com",
      qr_payload: "openclaw://pair?relay=https%3A%2F%2Frelay.example.com&code=ABCD-2345"
    });

    expect(output).toContain("Pairing session ID: ps_123");
    expect(output).toContain("Pairing code: ABCD-2345");
    expect(output).toContain("Relay URL: https://relay.example.com");
    expect(output).toContain("QR payload: openclaw://pair?");
  });
});
