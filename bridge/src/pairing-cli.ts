import { pathToFileURL } from "node:url";
import { resolveRuntimeEnv, loadConfig } from "./config.js";

interface CliOptions {
  apiBaseUrl?: string;
  adminToken?: string;
  platform?: string;
  deviceDisplayNameHint?: string;
}

export async function runPairingCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const env = resolveRuntimeEnv();
  const config = loadConfig(env);
  const options = parseArgs(argv);
  const apiBaseUrl = options.apiBaseUrl?.trim() || `http://127.0.0.1:${config.port}`;
  const adminToken = options.adminToken?.trim() || config.adminApiToken;

  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/v1/pairing/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      platform: options.platform || "even_hub",
      ...(options.deviceDisplayNameHint ? { device_display_name_hint: options.deviceDisplayNameHint } : {})
    })
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    const error = typeof json?.error === "string" ? json.error : `Request failed with ${response.status}`;
    throw new Error(error);
  }

  console.log(formatPairingSessionOutput(json));
}

export function formatPairingSessionOutput(session: Record<string, unknown>): string {
  return [
    "OpenClaw pairing session created.",
    `Pairing session ID: ${String(session.pairing_session_id ?? "")}`,
    `Pairing code: ${String(session.pairing_code ?? "")}`,
    `Expires at: ${String(session.expires_at ?? "")}`,
    `Relay URL: ${String(session.relay_base_url ?? "")}`,
    `QR payload: ${String(session.qr_payload ?? "")}`
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case "--api-base-url":
        if (next) {
          options.apiBaseUrl = next;
          index += 1;
        }
        break;
      case "--admin-token":
        if (next) {
          options.adminToken = next;
          index += 1;
        }
        break;
      case "--platform":
        if (next) {
          options.platform = next;
          index += 1;
        }
        break;
      case "--device-display-name-hint":
        if (next) {
          options.deviceDisplayNameHint = next;
          index += 1;
        }
        break;
      default:
        break;
    }
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPairingCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
