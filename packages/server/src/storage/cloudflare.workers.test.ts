import { env } from "cloudflare:test";
import { storageContract } from "./contract.ts";
import { openD1 } from "./d1.ts";
import { openR2Blobs } from "./r2.ts";

/** Storage lasts for the whole test file here, so each test starts from a reset. */
storageContract("d1 + r2", async () => {
  const storage = { meta: openD1(env.DB).meta, blobs: openR2Blobs(env.BLOBS) };
  await storage.meta.reset([]);
  await storage.blobs.clear();
  return storage;
});
