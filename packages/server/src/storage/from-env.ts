import { openPostgres, postgresPool } from "./postgres.ts";
import { openS3Blobs, s3Client } from "./s3.ts";
import { openSqlite } from "./sqlite.ts";
import type { Storage } from "./types.ts";

/**
 * Postgres when a database URL is set (Heroku and others set DATABASE_URL), else SQLite on disk.
 * With a bucket set, blobs go to S3, configured by the SDK's standard AWS_* variables.
 */
export function storageFromEnv(env: Record<string, string | undefined>): Storage {
  const url = env.FLOW_SYNC_DATABASE_URL ?? env.DATABASE_URL;
  const storage = url
    ? openPostgres(postgresPool(url))
    : openSqlite(env.FLOW_SYNC_DATA ?? "/data/flow-sync.db");
  const bucket = env.FLOW_SYNC_S3_BUCKET;
  if (!bucket) return storage;
  return {
    meta: storage.meta,
    blobs: openS3Blobs(s3Client({ forcePathStyle: env.FLOW_SYNC_S3_PATH_STYLE === "1" }), bucket),
  };
}
