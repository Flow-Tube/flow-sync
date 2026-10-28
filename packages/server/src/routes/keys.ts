import { Hono } from "hono";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import { octets } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";

/** A member may read only its own wrap, and the history chain. */
export function keyRoutes(deps: AuthDeps) {
  return new Hono<AppEnv>().get(
    "/v1/keys/:epoch{[0-9a-f]{8}}/:name{(?:[0-9a-f]{32}|chain)\\.k}",
    requireMember(deps, { allowRecovery: true }),
    async (c) => {
      const name = c.req.param("name").slice(0, -2);
      if (name !== "chain" && name !== c.get("did")) throw new HttpError("forbidden");
      const data = await deps.meta.getKey(Number.parseInt(c.req.param("epoch"), 16), name);
      if (!data) throw new HttpError("not_found");
      return octets(c, data);
    },
  );
}
