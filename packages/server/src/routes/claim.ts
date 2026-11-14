import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../auth/admin.ts";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";
import type { Group } from "../group.ts";
import { limitBody, readJson } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import type { Guards } from "../limits/guards.ts";
import { LIMITS } from "../limits.ts";

const claimSchema = z.strictObject({ entry: z.unknown(), wraps: z.record(z.string(), z.string()) });

export function claimRoutes(config: Config, group: Group, guards: Guards) {
  return new Hono<AppEnv>().post(
    "/v1/claim",
    requireAdmin(config, guards),
    limitBody(LIMITS.jsonBody),
    async (c) => {
      const body = await readJson(c, claimSchema);
      if (await group.roster()) throw new HttpError("conflict");
      await group.append(body.entry, body.wraps);
      return c.body(null, 201);
    },
  );
}
