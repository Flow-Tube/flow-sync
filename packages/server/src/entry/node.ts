import { readFileSync } from "node:fs";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { clientIp, listen, upgradeWebSocket } from "../runtime/node.ts";
import { openSqlite } from "../storage/sqlite.ts";

const env = { ...process.env };
if (env.FLOW_SYNC_ADMIN_TOKEN_FILE) {
  env.FLOW_SYNC_ADMIN_TOKEN = readFileSync(env.FLOW_SYNC_ADMIN_TOKEN_FILE, "utf8").trim();
}

const server = listen(
  createApp({
    config: loadConfig(env, true),
    storage: openSqlite(env.FLOW_SYNC_DATA ?? "/data/flow-sync.db"),
    log: (line) => console.log(JSON.stringify(line)),
    now: Date.now,
    clientIp: clientIp(env.FLOW_SYNC_TRUST_PROXY === "1"),
    upgradeWebSocket,
  }),
  Number(env.PORT ?? 8080),
  ({ port }) => console.log(JSON.stringify({ event: "listening", port })),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
