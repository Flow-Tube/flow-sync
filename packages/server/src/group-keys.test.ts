import { parseEntry, toB64, WRAP_SIZE } from "@flow-sync/protocol";
import { expect, test } from "vitest";
import vectors from "../../../spec/vectors/roster.json" with { type: "json" };
import { Group } from "./group.ts";
import { openSqlite } from "./storage/sqlite.ts";

const negative = (name: string) => {
  const found = vectors.negatives.find((n) => n.name === name);
  if (!found) throw new Error(name);
  return parseEntry(found.entry);
};
const wrap = toB64(new Uint8Array(WRAP_SIZE));
const genesis = parseEntry(vectors.entries[0]);
const wraps = (dids: string[]) => Object.fromEntries(dids.map((did) => [did, wrap]));

async function claimed() {
  const { meta } = openSqlite(":memory:");
  const group = new Group(meta);
  await group.append(genesis, wraps(genesis.epoch?.to ?? []));
  return { meta, group };
}

test("a key with a small-order part can't enter the roster", async () => {
  const { group } = await claimed();
  const entry = negative("mixed-order-key");
  const added = (entry.add ?? []).map((s) => s.did);
  await expect(group.append(entry, wraps(added))).rejects.toMatchObject({ code: "roster-key" });
});

test("an entry signed with a small-order R is refused", async () => {
  const { group } = await claimed();
  await expect(group.append(negative("small-order-r"), {})).rejects.toMatchObject({
    code: "roster-signature",
  });
});

test("replaying stored entries doesn't repeat the check on a key's order", async () => {
  const { meta, group } = await claimed();
  const before = await group.roster();
  const entry = negative("mixed-order-key");
  const appended = await meta.appendRoster({
    seq: entry.seq,
    prev: before?.head,
    hash: "00".repeat(32),
    entry: JSON.stringify(entry),
    keys: [],
  });
  expect(appended).toBe(true);
  await expect(new Group(meta).roster()).resolves.toMatchObject({ seq: entry.seq });
});
