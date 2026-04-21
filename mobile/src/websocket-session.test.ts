import { describe, expect, it, vi } from "vitest";
import type { SocketLike } from "./websocket-session.js";
import { RelayWebSocketSession } from "./websocket-session.js";

describe("RelayWebSocketSession", () => {
  it("sends hello on initial connect and responds to ping with pong", () => {
    const sockets: FakeSocket[] = [];
    const session = new RelayWebSocketSession({
      websocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      }
    });

    session.connect(
      {
        ticket: "wst_123",
        expires_at: "2026-04-21T01:00:00.000Z",
        ws_url: "wss://api.example.com/v1/relay/ws?ticket=wst_123"
      },
      "default"
    );

    const socket = sockets[0]!;
    socket.open();

    expect(socket.sentMessages[0]).toEqual({
      type: "hello",
      conversation_id: "default",
      app_state: "foreground"
    });

    socket.message({
      type: "ping",
      ping_id: "png_123"
    });

    expect(socket.sentMessages[1]).toEqual({
      type: "pong",
      ping_id: "png_123"
    });
  });

  it("uses resume when reconnecting with pending state", () => {
    const socket = new FakeSocket("wss://api.example.com/v1/relay/ws?ticket=wst_123");
    const websocketFactory = vi.fn(() => socket as SocketLike);
    const resumedSession = new RelayWebSocketSession({ websocketFactory });

    resumedSession.connect(
      {
        ticket: "wst_123",
        expires_at: "2026-04-21T01:00:00.000Z",
        ws_url: "wss://api.example.com/v1/relay/ws?ticket=wst_123"
      },
      "default",
      "evt_123",
      "prm_123"
    );

    socket.open();

    expect(socket.sentMessages[0]).toEqual({
      type: "resume",
      conversation_id: "default",
      last_event_id: "evt_123",
      pending_prompt_id: "prm_123"
    });
  });
});

class FakeSocket implements SocketLike {
  readonly sentMessages: Array<Record<string, unknown>> = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}
