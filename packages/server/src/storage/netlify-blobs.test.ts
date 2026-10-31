import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { afterAll, beforeAll } from "vitest";
import { storageContract } from "./contract.ts";
import { openNetlifyBlobs } from "./netlify-blobs.ts";
import { openSqlite } from "./sqlite.ts";

const token = "netlify-blobs-test";
const directory = mkdtempSync(join(tmpdir(), "flow-sync-blobs-"));
const server = new BlobsServer({ directory, token });
let edgeURL = "";
let stores = 0;

beforeAll(async () => {
  edgeURL = `http://127.0.0.1:${(await server.start()).port}`;
});
afterAll(async () => {
  await server.stop();
  rmSync(directory, { recursive: true, force: true });
});

storageContract("sqlite + netlify blobs", () => ({
  meta: openSqlite(":memory:").meta,
  blobs: openNetlifyBlobs({
    name: `test-${++stores}`,
    edgeURL,
    uncachedEdgeURL: edgeURL,
    siteID: "site",
    token,
  }),
}));
