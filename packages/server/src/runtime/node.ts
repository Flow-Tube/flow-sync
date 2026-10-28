import type { AddressInfo } from "node:net";
import { serve, upgradeWebSocket, type WebSocketServerLike } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { WebSocketServer } from "ws";
import type { createApp } from "../app.ts";
import { LIMITS } from "../limits.ts";
import { LIVE_PROTOCOL } from "../routes/live.ts";

const SWEEP_MS = 15_000;

export { upgradeWebSocket };

/** Behind a trusted proxy (Caddy), the last X-Forwarded-For hop is the one the proxy added. */
export function clientIp(trustProxy: boolean) {
  return (c: Context) =>
    trustProxy
      ? c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim()
      : getConnInfo(c).remote.address;
}

export function listen(
  { app, hub }: ReturnType<typeof createApp>,
  port: number,
  onListening?: (info: AddressInfo) => void,
) {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.liveMessage,
    handleProtocols: (protocols) => (protocols.has(LIVE_PROTOCOL) ? LIVE_PROTOCOL : false),
  });
  const sweep = setInterval(() => void hub.sweep(), SWEEP_MS);
  sweep.unref();
  const http = serve(
    {
      fetch: app.fetch,
      port,
      // @types/ws marks noServer optional, which exactOptionalPropertyTypes rejects.
      websocket: { server: server as WebSocketServerLike },
      serverOptions: { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 },
    },
    onListening,
  );
  http.on("close", () => {
    clearInterval(sweep);
    server.close();
  });
  return http;
}
