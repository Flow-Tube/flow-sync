import type { Hono } from "hono";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { durableLive, type LiveEnv } from "../live/durable.ts";
import { openD1 } from "../storage/d1.ts";
import { openR2Blobs } from "../storage/r2.ts";

export { LiveRoom } from "../live/durable.ts";

export interface Env extends LiveEnv {
  BLOBS: R2Bucket;
}

/** Built once per isolate, so the roster cache outlives a request. */
let app: Hono<AppEnv> | undefined;

export default {
  fetch(request, env, ctx) {
    app ??= createApp({
      config: loadConfig({ ...env }, true),
      storage: { meta: openD1(env.DB).meta, blobs: openR2Blobs(env.BLOBS) },
      log: (line) => console.log(JSON.stringify(line)),
      now: Date.now,
      clientIp: (c) => c.req.header("cf-connecting-ip"),
      live: durableLive(env.LIVE),
    }).app;
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
