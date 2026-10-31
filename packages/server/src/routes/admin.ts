import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../auth/admin.ts";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { type Group, INSTANCE_SETTINGS } from "../group.ts";
import { limitBody, readJson } from "../http/body.ts";
import type { Guards } from "../limits/guards.ts";
import { LIMITS } from "../limits.ts";
import type { Storage } from "../storage/types.ts";

const resetSchema = z.strictObject({ confirm: z.literal("reset") });

export function adminRoutes(
  config: Config,
  group: Group,
  { meta, blobs }: Storage,
  guards: Guards,
) {
  return new Hono<AppEnv>()
    .use("/v1/admin/*", requireAdmin(config, guards))
    .get("/v1/admin/usage", async (c) => {
      const [state, usage, devices] = await Promise.all([
        group.roster(),
        meta.usage(),
        meta.devices(),
      ]);
      return c.json({
        used: usage.bytes,
        quota: config.quota,
        objects: usage.objects,
        rosterEntries: state ? state.seq + 1 : 0,
        devices: Object.keys(devices).length,
      });
    })
    .post("/v1/admin/reset", limitBody(LIMITS.jsonBody), async (c) => {
      await readJson(c, resetSchema);
      await meta.reset(INSTANCE_SETTINGS);
      group.forget();
      await blobs.clear();
      return c.body(null, 204);
    });
}
