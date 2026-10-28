import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Config } from "./config.ts";
import type { AppEnv } from "./env.ts";
import { Group } from "./group.ts";
import { errorCode, errorResponse, HttpError } from "./http/errors.ts";
import { type Logger, requestLog } from "./http/log.ts";
import { type ClientIp, createGuards, guardRequests } from "./limits/guards.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { claimRoutes } from "./routes/claim.ts";
import { keyRoutes } from "./routes/keys.ts";
import { metaRoutes } from "./routes/meta.ts";
import { objectRoutes } from "./routes/objects.ts";
import { pairRoutes } from "./routes/pair.ts";
import { rosterRoutes } from "./routes/roster.ts";
import { statusRoutes } from "./routes/status.ts";
import type { Storage } from "./storage/types.ts";

export interface AppDeps {
  config: Config;
  storage: Storage;
  log: Logger;
  now: () => number;
  clientIp: ClientIp;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use(requestLog(deps.log, deps.now));
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      referrerPolicy: "no-referrer",
      crossOriginResourcePolicy: "same-origin",
    }),
  );
  app.use(async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  const guards = createGuards(deps.clientIp, deps.now);
  app.use(guardRequests(guards));
  app.onError((error, c) => {
    c.set("errorCode", errorCode(error));
    return errorResponse(c, error);
  });
  app.notFound((c) => {
    c.set("errorCode", "not_found");
    return errorResponse(c, new HttpError("not_found"));
  });
  const group = new Group(deps.storage.meta);
  app.route("/", metaRoutes(deps.config, group));
  const members = { group, meta: deps.storage.meta, now: deps.now, guards };
  app.route("/", claimRoutes(deps.config, group, guards));
  app.route("/", adminRoutes(deps.config, group, deps.storage.meta, guards));
  app.route("/", authRoutes(members));
  app.route("/", rosterRoutes(members));
  app.route("/", keyRoutes(members));
  app.route("/", objectRoutes({ ...members, blobs: deps.storage.blobs }, deps.config));
  app.route("/", pairRoutes(members));
  app.route("/", statusRoutes(members, deps.config));
  return app;
}
