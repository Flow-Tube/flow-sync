import { openPostgres, postgresPool } from "./postgres.ts";
import { openSqlite } from "./sqlite.ts";
import type { Storage } from "./types.ts";

/** Postgres when a database URL is set (Heroku and others set DATABASE_URL), else SQLite on disk. */
export function storageFromEnv(env: Record<string, string | undefined>): Storage {
  const url = env.FLOW_SYNC_DATABASE_URL ?? env.DATABASE_URL;
  if (url) return openPostgres(postgresPool(url));
  return openSqlite(env.FLOW_SYNC_DATA ?? "/data/flow-sync.db");
}
