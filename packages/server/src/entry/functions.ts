import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { databaseUrl, openPostgres, postgresPool } from "../storage/postgres.ts";
import type { BlobStore } from "../storage/types.ts";

/** Hosts that run the server as functions: Postgres metadata, the host's blobs, live off. */
export function functionApp(blobs: BlobStore, clientIpHeader: string) {
  const env = process.env;
  const url = databaseUrl(env);
  if (!url) throw new Error("flow-sync needs a Postgres URL in DATABASE_URL");
  return createApp({
    config: loadConfig(env, false),
    storage: { meta: openPostgres(postgresPool(url)).meta, blobs },
    log: (line) => console.log(JSON.stringify(line)),
    now: Date.now,
    clientIp: (c) => c.req.header(clientIpHeader),
  }).app;
}
