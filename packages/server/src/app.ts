import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Config } from "./config.ts";
import type { AppEnv } from "./env.ts";
import { errorCode, errorResponse, HttpError } from "./http/errors.ts";
import { type Logger, requestLog } from "./http/log.ts";
import { metaRoutes } from "./routes/meta.ts";

export interface AppDeps {
  config: Config;
  log: Logger;
  now: () => number;
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
  app.onError((error, c) => {
    c.set("errorCode", errorCode(error));
    return errorResponse(c, error);
  });
  app.notFound((c) => {
    c.set("errorCode", "not_found");
    return errorResponse(c, new HttpError("not_found"));
  });
  app.route("/", metaRoutes(deps.config));
  return app;
}
