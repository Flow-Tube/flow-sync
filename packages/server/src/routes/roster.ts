import { parseEntry } from "@flow-sync/protocol";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import { limitBody, readJson } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";
import type { Stored } from "../live/relay.ts";

const appendSchema = z.strictObject({
  entry: z.unknown(),
  wraps: z.record(z.string(), z.string()),
  chain: z.string().optional(),
});
const afterSchema = z.coerce.number().int().min(-1).default(-1);

export function rosterRoutes(deps: AuthDeps & { stored: Stored }) {
  const member = requireMember(deps, { allowRecovery: true });
  return new Hono<AppEnv>()
    .get("/v1/roster", member, async (c) => {
      const after = afterSchema.parse(c.req.query("after"));
      const entries = await deps.meta.rosterAfter(after, LIMITS.rosterPage);
      return c.json({ entries: entries.map((json) => JSON.parse(json)) });
    })
    .post("/v1/roster", member, limitBody(LIMITS.jsonBody), async (c) => {
      const body = await readJson(c, appendSchema);
      const state = await deps.group.claimed();
      if (c.req.header("if-match")?.replaceAll('"', "") !== state.head) {
        throw new HttpError("conflict", { head: state.head });
      }
      await deps.group.append(parseEntry(body.entry), body.wraps, body.chain);
      await deps.stored(c.get("did"));
      return c.body(null, 201);
    });
}
