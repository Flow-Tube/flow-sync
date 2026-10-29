import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, onTestFinished, test } from "vitest";
import { storageContract } from "./contract.ts";
import { openSqlite } from "./sqlite.ts";

storageContract("sqlite", () => openSqlite(":memory:"));

test("opening an older database adds new columns and keeps its rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-sync-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "old.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE join_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL,
    expires INTEGER NOT NULL, code TEXT);
    INSERT INTO join_requests (id, name, expires) VALUES ('j1', 'Phone', 100);`);
  old.close();
  const store = openSqlite(path);
  expect(await store.meta.openJoinRequests(0)).toEqual([{ id: "j1", name: "Phone", expires: 100 }]);
  expect(await store.meta.declineJoinRequest("j1", 0)).toBe(true);
});
