import { describe, expect, it } from "vitest";
import { validatePairingForm } from "./validation";

describe("validatePairingForm", () => {
  it("accepts a valid pairing submission with an optional session id", () => {
    const result = validatePairingForm({
      relayBaseUrl: "https://api.example.com/",
      pairingSessionId: "ps_01JV8N9GM88Q6YCC8FX5MWA4Y1",
      pairingCode: "abcd-1234",
      deviceDisplayName: "Jon's iPhone"
    });

    expect(result).toEqual({
      ok: true,
      value: {
        relayBaseUrl: "https://api.example.com",
        pairingSessionId: "ps_01JV8N9GM88Q6YCC8FX5MWA4Y1",
        pairingCode: "ABCD-1234",
        deviceDisplayName: "Jon's iPhone"
      }
    });
  });

  it("flags URL and token mistakes in the pairing code field", () => {
    const result = validatePairingForm({
      relayBaseUrl: "https://api.example.com",
      pairingSessionId: "",
      pairingCode: "https://api.example.com",
      deviceDisplayName: "Jon's iPhone"
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        pairingCode: "This looks like a relay URL. Paste it into the Relay URL field."
      }
    });
  });
});
