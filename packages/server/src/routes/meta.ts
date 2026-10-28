import { Hono } from "hono";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";

export function metaRoutes(config: Config) {
  return new Hono<AppEnv>()
    .get("/", (c) => c.text("flow-sync"))
    .get("/v1/health", (c) => c.json({ status: "ok" }))
    .get("/v1/info", (c) =>
      c.json({ api: ["v1"], protocol: ["FLOW-SYNC/2"], live: config.live, limits: LIMITS }),
    )
    .get("/.well-known/security.txt", (c) => {
      if (!config.securityTxt) throw new HttpError("not_found");
      const { contact, expires } = config.securityTxt;
      return c.text(`Contact: ${contact}\nExpires: ${expires}\n`);
    });
}
