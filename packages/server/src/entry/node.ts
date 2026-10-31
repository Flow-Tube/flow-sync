import { readFileSync } from "node:fs";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { clientIp, listen, nodeLive } from "../runtime/node.ts";
import { storageFromEnv } from "../storage/from-env.ts";

const env = { ...process.env };
if (env.FLOW_SYNC_ADMIN_TOKEN_FILE) {
  env.FLOW_SYNC_ADMIN_TOKEN = readFileSync(env.FLOW_SYNC_ADMIN_TOKEN_FILE, "utf8").trim();
}

const server = listen(
  createApp({
    config: loadConfig(env, true),
    storage: storageFromEnv(env),
    log: (line) => console.log(JSON.stringify(line)),
    now: Date.now,
    clientIp: clientIp(env.FLOW_SYNC_TRUST_PROXY === "1"),
    live: nodeLive,
  }),
  Number(env.PORT ?? 8080),
  ({ port }) => console.log(JSON.stringify({ event: "listening", port })),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
