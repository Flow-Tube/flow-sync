import { Hono } from "hono";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import { liveToken } from "../http/body.ts";
import type { LiveRelay } from "../live/relay.ts";

export const LIVE_PROTOCOL = "flow-sync.v1";

export function liveRoutes(deps: AuthDeps, relay: LiveRelay) {
  return new Hono<AppEnv>().get(
    "/v1/live",
    requireMember(deps, { token: liveToken }),
    relay.upgrade,
  );
}
