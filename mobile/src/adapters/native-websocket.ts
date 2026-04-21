import type { SocketLike, WebSocketFactory } from "../websocket-session";

export function createNativeWebSocketFactory(): WebSocketFactory {
  return (url: string) => new WebSocket(url) as unknown as SocketLike;
}
