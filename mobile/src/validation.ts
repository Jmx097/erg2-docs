import { normalizeRelayBaseUrl } from "./auth-client";

export interface PairingFormInput {
  relayBaseUrl: string;
  pairingSessionId: string;
  pairingCode: string;
  deviceDisplayName: string;
}

export interface PairingFormErrors {
  relayBaseUrl?: string;
  pairingSessionId?: string;
  pairingCode?: string;
  deviceDisplayName?: string;
}

export interface NormalizedPairingForm {
  relayBaseUrl: string;
  pairingSessionId?: string;
  pairingCode: string;
  deviceDisplayName: string;
}

export function validatePairingForm(input: PairingFormInput):
  | { ok: true; value: NormalizedPairingForm }
  | { ok: false; errors: PairingFormErrors } {
  const errors: PairingFormErrors = {};
  const relayBaseUrl = normalizeRelayBaseUrl(input.relayBaseUrl);
  const pairingSessionId = input.pairingSessionId.trim();
  const pairingCode = input.pairingCode.trim().toUpperCase();
  const deviceDisplayName = input.deviceDisplayName.trim();

  if (!relayBaseUrl) {
    errors.relayBaseUrl = "Relay URL is required.";
  } else {
    try {
      const parsed = new URL(relayBaseUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        errors.relayBaseUrl = "Relay URL must start with https:// or http://.";
      }
    } catch {
      errors.relayBaseUrl = "Enter a full relay URL like https://api.example.com.";
    }
  }

  if (pairingSessionId && !/^ps_[a-z0-9]+$/i.test(pairingSessionId)) {
    errors.pairingSessionId = "Pairing session IDs start with ps_.";
  }

  if (!pairingCode) {
    errors.pairingCode = "Pairing code is required.";
  } else if (/^https?:\/\//i.test(pairingCode) || /^wss?:\/\//i.test(pairingCode)) {
    errors.pairingCode = "This looks like a relay URL. Paste it into the Relay URL field.";
  } else if (pairingCode.split(".").length === 3 || pairingCode.length > 32) {
    errors.pairingCode = "This looks like a token. Pair with a short code or QR scan instead.";
  } else if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(pairingCode)) {
    errors.pairingCode = "Pairing code must match XXXX-XXXX.";
  }

  if (!deviceDisplayName) {
    errors.deviceDisplayName = "Device name is required.";
  } else if (deviceDisplayName.length > 48) {
    errors.deviceDisplayName = "Device name must stay under 48 characters.";
  }

  if (errors.relayBaseUrl || errors.pairingSessionId || errors.pairingCode || errors.deviceDisplayName) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      relayBaseUrl,
      ...(pairingSessionId ? { pairingSessionId } : {}),
      pairingCode,
      deviceDisplayName
    }
  };
}
