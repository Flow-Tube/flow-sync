import { test } from "vitest";
import { storageContract } from "./contract.ts";
import { openSqlite } from "./sqlite.ts";
import { openVercelBlobs } from "./vercel-blob.ts";

// Vercel Blob has no local emulator; this runs only against a real store's token.
if (process.env.BLOB_READ_WRITE_TOKEN) {
  storageContract("sqlite + vercel blob", async () => {
    const blobs = openVercelBlobs();
    await blobs.clear();
    return { meta: openSqlite(":memory:").meta, blobs };
  });
} else {
  test.skip("vercel blob storage needs BLOB_READ_WRITE_TOKEN", () => {});
}
