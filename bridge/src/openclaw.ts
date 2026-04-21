import type { BridgeConfig } from "./config.js";
import { logBridgeEvent } from "./logger.js";

export const G2_HUD_SYSTEM_PROMPT =
  "You are OpenClaw replying on Even Realities G2 glasses. Reply for a small HUD, under 400 characters unless the user explicitly asks for more. Avoid markdown tables and long lists.";
const TRANSIENT_REPLY_RETRY_DELAYS_MS = [400, 1_200];
const MAX_LOGGED_REPLY_LENGTH = 160;

export interface OpenClawHealth {
  ok: boolean;
  status?: number;
  modelCount?: number;
  error?: string;
}

export interface ChatCompletionInput {
  requestId: string;
  sessionKey: string;
  prompt: string;
  messageChannel?: string;
  systemPrompt?: string;
}

export interface ChatCompletionResult {
  reply: string;
  model: string;
  sessionKey: string;
}

export type PublicFailureKind = FailureKind;

export class OpenClawRequestError extends Error {
  constructor(
    message: string,
    readonly failureKind: PublicFailureKind
  ) {
    super(message);
    this.name = "OpenClawRequestError";
  }
}

export type FetchLike = typeof fetch;
export type SleepLike = (ms: number) => Promise<void>;
export type LoggerLike = (entry: AttemptLogEntry | ResultLogEntry) => void;

export class OpenClawClient {
  constructor(
    private readonly config: Pick<
      BridgeConfig,
      "openclawBaseUrl" | "openclawGatewayToken" | "openclawModel" | "openclawRequestTimeoutMs"
    >,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleepImpl: SleepLike = sleep,
    private readonly logger: LoggerLike = logJson
  ) {}

  async checkHealth(): Promise<OpenClawHealth> {
    try {
      const response = await this.fetchWithTimeout(`${this.config.openclawBaseUrl}/v1/models`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.config.openclawGatewayToken}`
        }
      });

      if (response.status === 404) {
        return { ok: true, status: response.status };
      }

      if (!response.ok) {
        return { ok: false, status: response.status, error: `OpenClaw returned ${response.status}` };
      }

      const json = (await response.json().catch(() => ({}))) as { data?: unknown[] };
      return {
        ok: true,
        status: response.status,
        modelCount: Array.isArray(json.data) ? json.data.length : undefined
      };
    } catch (error) {
      return { ok: false, error: publicErrorMessage(error) };
    }
  }

  async createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const maxAttempts = TRANSIENT_REPLY_RETRY_DELAYS_MS.length + 1;
    const totalStartedAtMs = Date.now();
    const messageChannel = input.messageChannel ?? "g2";
    const systemPrompt = input.systemPrompt ?? G2_HUD_SYSTEM_PROMPT;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const attempt = attemptIndex + 1;
      const attemptStartedAtMs = Date.now();
      const startedAt = new Date(attemptStartedAtMs).toISOString();

      let response: Response;
      try {
        response = await this.fetchWithTimeout(`${this.config.openclawBaseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.openclawGatewayToken}`,
            "content-type": "application/json",
            "x-openclaw-message-channel": messageChannel,
            "x-openclaw-session-key": input.sessionKey
          },
          body: JSON.stringify({
            model: this.config.openclawModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: input.prompt }
            ]
          })
        });
      } catch (error) {
        const failureKind = classifyThrownError(error);
        this.logger({
          event: "openclaw_upstream_attempt",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attempt,
          maxAttempts,
          startedAt,
          elapsedMs: Date.now() - attemptStartedAtMs,
          ok: false,
          retryable: false,
          failureKind
        });
        this.logger({
          event: "openclaw_upstream_result",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attemptsUsed: attempt,
          finalOutcome: failureKind === "timeout" ? "timeout" : "network_error",
          totalElapsedMs: Date.now() - totalStartedAtMs
        });
        throw new OpenClawRequestError(messageForFailureKind(failureKind), failureKind);
      }

      if (!response.ok) {
        this.logger({
          event: "openclaw_upstream_attempt",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attempt,
          maxAttempts,
          startedAt,
          elapsedMs: Date.now() - attemptStartedAtMs,
          httpStatus: response.status,
          ok: false,
          retryable: false,
          failureKind: "http_error"
        });
        this.logger({
          event: "openclaw_upstream_result",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attemptsUsed: attempt,
          finalOutcome: "http_error",
          totalElapsedMs: Date.now() - totalStartedAtMs,
          finalHttpStatus: response.status
        });

        const body = await response.text().catch(() => "");
        throw new OpenClawRequestError(
          `OpenClaw upstream returned ${response.status}: ${truncate(body || response.statusText || "Unknown error", 300)}`,
          "http_error"
        );
      }

      let data: OpenAICompatibleChatResponse;
      try {
        data = (await response.json()) as OpenAICompatibleChatResponse;
      } catch {
        this.logger({
          event: "openclaw_upstream_attempt",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attempt,
          maxAttempts,
          startedAt,
          elapsedMs: Date.now() - attemptStartedAtMs,
          httpStatus: response.status,
          ok: false,
          retryable: false,
          failureKind: "invalid_response"
        });
        this.logger({
          event: "openclaw_upstream_result",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attemptsUsed: attempt,
          finalOutcome: "invalid_response",
          totalElapsedMs: Date.now() - totalStartedAtMs,
          finalHttpStatus: response.status
        });
        throw new OpenClawRequestError(messageForFailureKind("invalid_response"), "invalid_response");
      }

      const reply = extractReply(data);
      const upstreamModel = data.model || this.config.openclawModel;
      if (!reply) {
        this.logger({
          event: "openclaw_upstream_attempt",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attempt,
          maxAttempts,
          startedAt,
          elapsedMs: Date.now() - attemptStartedAtMs,
          httpStatus: response.status,
          ok: false,
          upstreamModel,
          retryable: false,
          failureKind: "invalid_response"
        });
        this.logger({
          event: "openclaw_upstream_result",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attemptsUsed: attempt,
          finalOutcome: "invalid_response",
          totalElapsedMs: Date.now() - totalStartedAtMs,
          finalHttpStatus: response.status
        });
        throw new OpenClawRequestError(messageForFailureKind("invalid_response"), "invalid_response");
      }

      const replyClassification = classifyReply(reply);
      const replyText = truncate(reply, MAX_LOGGED_REPLY_LENGTH);
      this.logger({
        event: "openclaw_upstream_attempt",
        requestId: input.requestId,
        sessionKey: input.sessionKey,
        attempt,
        maxAttempts,
        startedAt,
        elapsedMs: Date.now() - attemptStartedAtMs,
        httpStatus: response.status,
        ok: true,
        upstreamModel,
        replyText,
        retryable: replyClassification.retryable,
        failureKind: replyClassification.failureKind
      });

      if (replyClassification.failureKind) {
        if (replyClassification.retryable && attempt < maxAttempts) {
          await this.sleepImpl(TRANSIENT_REPLY_RETRY_DELAYS_MS[attemptIndex]!);
          continue;
        }

        this.logger({
          event: "openclaw_upstream_result",
          requestId: input.requestId,
          sessionKey: input.sessionKey,
          attemptsUsed: attempt,
          finalOutcome: replyClassification.finalOutcome,
          totalElapsedMs: Date.now() - totalStartedAtMs,
          finalReplyText: replyText,
          finalHttpStatus: response.status
        });
        throw new OpenClawRequestError(
          messageForFailureKind(replyClassification.failureKind),
          replyClassification.failureKind
        );
      }

      this.logger({
        event: "openclaw_upstream_result",
        requestId: input.requestId,
        sessionKey: input.sessionKey,
        attemptsUsed: attempt,
        finalOutcome: replyClassification.finalOutcome,
        totalElapsedMs: Date.now() - totalStartedAtMs,
        finalReplyText: replyText,
        finalHttpStatus: response.status
      });

      return {
        reply,
        model: upstreamModel,
        sessionKey: input.sessionKey
      };
    }

    throw new Error("OpenClaw exhausted retry attempts");
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.openclawRequestTimeoutMs);

    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildG2SessionKey(installId: string): string {
  return `g2:${normalizeInstallId(installId)}`;
}

export function normalizeInstallId(installId: string): string {
  return installId.trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 128);
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof OpenClawRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "OpenClaw timed out";
    }

    return truncate(error.message, 300);
  }

  return "Unknown OpenClaw error";
}

export function getFailureKind(error: unknown): PublicFailureKind | undefined {
  return error instanceof OpenClawRequestError ? error.failureKind : undefined;
}

function extractReply(data: OpenAICompatibleChatResponse): string {
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function classifyReply(reply: string): {
  retryable: boolean;
  failureKind?: FailureKind;
  finalOutcome: FinalOutcome;
} {
  if (reply === "Even AI is busy with another request. Please retry shortly.") {
    return { retryable: true, failureKind: "busy", finalOutcome: "busy" };
  }

  if (reply === "Even AI request failed upstream. Please try again.") {
    return { retryable: true, failureKind: "upstream_failed", finalOutcome: "upstream_failed" };
  }

  if (reply === "Authentication failed.") {
    return { retryable: false, failureKind: "auth", finalOutcome: "auth" };
  }

  return { retryable: false, finalOutcome: "success" };
}

function classifyThrownError(error: unknown): "timeout" | "network_error" {
  return error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
}

function messageForFailureKind(failureKind: FailureKind): string {
  switch (failureKind) {
    case "busy":
      return "OpenClaw is busy; retry shortly";
    case "upstream_failed":
      return "OpenClaw upstream failed; retry shortly";
    case "timeout":
      return "OpenClaw timed out";
    case "auth":
      return "OpenClaw authentication failed";
    case "http_error":
      return "OpenClaw upstream returned an error";
    case "invalid_response":
      return "OpenClaw returned an invalid reply";
    case "network_error":
      return "OpenClaw network error";
  }
}

function logJson(entry: AttemptLogEntry | ResultLogEntry): void {
  logBridgeEvent(entry);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type FailureKind =
  | "busy"
  | "upstream_failed"
  | "timeout"
  | "auth"
  | "http_error"
  | "invalid_response"
  | "network_error";

type FinalOutcome = "success" | FailureKind;

interface AttemptLogEntry {
  event: "openclaw_upstream_attempt";
  requestId: string;
  sessionKey: string;
  attempt: number;
  maxAttempts: number;
  startedAt: string;
  elapsedMs: number;
  httpStatus?: number;
  ok: boolean;
  upstreamModel?: string;
  replyText?: string;
  retryable: boolean;
  failureKind?: FailureKind;
}

interface ResultLogEntry {
  event: "openclaw_upstream_result";
  requestId: string;
  sessionKey: string;
  attemptsUsed: number;
  finalOutcome: FinalOutcome;
  totalElapsedMs: number;
  finalReplyText?: string;
  finalHttpStatus?: number;
}

interface OpenAICompatibleChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<string | { text?: string }>;
    };
  }>;
}
