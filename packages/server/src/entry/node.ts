import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { openSqlite } from "../storage/sqlite.ts";

const env = { ...process.env };
if (env.FLOW_SYNC_ADMIN_TOKEN_FILE) {
  env.FLOW_SYNC_ADMIN_TOKEN = readFileSync(env.FLOW_SYNC_ADMIN_TOKEN_FILE, "utf8").trim();
}

const app = createApp({
  config: loadConfig(env, true),
  storage: openSqlite(env.FLOW_SYNC_DATA ?? "/data/flow-sync.db"),
  log: (line) => console.log(JSON.stringify(line)),
  now: Date.now,
  clientIp: (c) =>
    env.FLOW_SYNC_TRUST_PROXY === "1"
      ? c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim()
      : getConnInfo(c).remote.address,
});

const port = Number(env.PORT ?? 8080);
const server = serve({
  fetch: app.fetch,
  port,
  serverOptions: { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 },
});
console.log(JSON.stringify({ event: "listening", port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
