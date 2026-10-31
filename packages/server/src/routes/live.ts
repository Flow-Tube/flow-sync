import { type Context, Hono } from "hono";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import type { LiveRelay } from "../live/relay.ts";

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

export function liveRoutes(deps: AuthDeps, relay: LiveRelay) {
  return new Hono<AppEnv>().get(
    "/v1/live",
    requireMember(deps, { token: liveToken }),
    relay.upgrade,
  );
}
