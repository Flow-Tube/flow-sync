import { type Context, Hono } from "hono";
import type { UpgradeWebSocket, WSMessageReceive } from "hono/ws";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import type { Connection, LiveHub } from "../live/hub.ts";

export const LIVE_PROTOCOL = "flow-sync.v1";
const BEARER = "bearer.";

/** Browsers can't set headers on a WebSocket, so the token travels as a subprotocol. */
function liveToken(c: Context): string | undefined {
  const protocols =
    c.req
      .header("sec-websocket-protocol")
      ?.split(",")
      .map((p) => p.trim()) ?? [];
  return protocols.find((p) => p.startsWith(BEARER))?.slice(BEARER.length);
}

async function bytesOf(data: WSMessageReceive): Promise<Uint8Array | string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

export function liveRoutes(deps: AuthDeps, hub: LiveHub, upgradeWebSocket: UpgradeWebSocket) {
  return new Hono<AppEnv>().get(
    "/v1/live",
    requireMember(deps, { token: liveToken }),
    upgradeWebSocket((c) => {
      let connection: Connection | undefined;
      return {
        onOpen: (_event, ws) => {
          connection = hub.join(c.get("did"), c.get("tokenExpires"), ws);
        },
        onMessage: async (event) => {
          if (connection) await hub.relay(connection, await bytesOf(event.data));
        },
        onClose: () => {
          if (connection) hub.leave(connection);
        },
      };
    }),
  );
}
