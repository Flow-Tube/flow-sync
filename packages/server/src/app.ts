import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Config } from "./config.ts";
import type { AppEnv } from "./env.ts";
import { Group } from "./group.ts";
import { errorCode, errorResponse, HttpError } from "./http/errors.ts";
import { type Logger, requestLog } from "./http/log.ts";
import { type ClientIp, createGuards, guardRequests } from "./limits/guards.ts";
import type { LiveFactory, LiveRelay } from "./live/relay.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { claimRoutes } from "./routes/claim.ts";
import { joinRoutes } from "./routes/join.ts";
import { keyRoutes } from "./routes/keys.ts";
import { liveRoutes } from "./routes/live.ts";
import { metaRoutes } from "./routes/meta.ts";
import { objectRoutes } from "./routes/objects.ts";
import { pairRoutes } from "./routes/pair.ts";
import { rosterRoutes } from "./routes/roster.ts";
import { statusRoutes } from "./routes/status.ts";
import type { Storage } from "./storage/types.ts";

export interface AppDeps<L extends LiveRelay> {
  config: Config;
  storage: Storage;
  log: Logger;
  now: () => number;
  clientIp: ClientIp;
  /** Absent on hosts that can't hold connections open; live features are then off. */
  live?: LiveFactory<L>;
}

export function createApp<L extends LiveRelay>(deps: AppDeps<L>) {
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
  const relay = deps.live?.(group, deps.now);
  const stored = (did: string) => relay?.changed(did);
  app.route("/", claimRoutes(deps.config, group, guards));
  app.route("/", adminRoutes(deps.config, group, deps.storage, guards));
  app.route("/", authRoutes(members));
  app.route("/", rosterRoutes({ ...members, stored }));
  app.route("/", keyRoutes(members));
  app.route("/", objectRoutes({ ...members, blobs: deps.storage.blobs, stored }, deps.config));
  app.route("/", pairRoutes(members));
  app.route("/", joinRoutes(members, deps.config, guards));
  app.route("/", statusRoutes(members, deps.config));
  if (relay) app.route("/", liveRoutes(members, relay));
  return { app, relay };
}
