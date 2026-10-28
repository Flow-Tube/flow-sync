import { Hono } from "hono";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";

export function statusRoutes(deps: AuthDeps, config: Config) {
  return new Hono<AppEnv>().get("/v1/status", requireMember(deps), async (c) => {
    const [state, usage, seen] = await Promise.all([
      deps.group.claimed(),
      deps.meta.usage(),
      deps.meta.devices(),
    ]);
    const current = Object.entries(seen).filter(([did]) => state.members.has(did));
    const devices = Object.fromEntries(current.map(([did, at]) => [did, { seen: at }]));
    return c.json({ used: usage.bytes, quota: config.quota, objects: usage.objects, devices });
  });
}
