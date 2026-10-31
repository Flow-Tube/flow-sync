import { beforeEach, describe, expect, test } from "vitest";
import type { Storage } from "./types.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const record = (path: string, hash: string, size = 10) => ({ path, did: "d1", hash, size });

/** The behaviour every storage adapter must have; each adapter's test calls this once. */
export function storageContract(name: string, open: () => Promise<Storage> | Storage) {
  describe(`${name} storage contract`, () => {
    let store: Storage;
    beforeEach(async () => {
      store = await open();
    });

    test("settings are written once", async () => {
      expect(await store.meta.setSettingOnce("group", "a")).toBe(true);
      expect(await store.meta.setSettingOnce("group", "b")).toBe(false);
      expect(await store.meta.getSetting("group")).toBe("a");
      expect(await store.meta.getSetting("missing")).toBeUndefined();
    });

    test("roster appends are linear and carry their keys", async () => {
      const keys = [{ epoch: 0, name: "d1", data: bytes(1, 2) }];
      expect(
        await store.meta.appendRoster({ seq: 1, prev: "h0", hash: "h1", entry: "e1", keys: [] }),
      ).toBe(false);
      expect(
        await store.meta.appendRoster({ seq: 0, prev: undefined, hash: "h0", entry: "e0", keys }),
      ).toBe(true);
      expect(
        await store.meta.appendRoster({
          seq: 0,
          prev: undefined,
          hash: "hx",
          entry: "ex",
          keys: [],
        }),
      ).toBe(false);
      expect(
        await store.meta.appendRoster({ seq: 1, prev: "stale", hash: "h1", entry: "e1", keys: [] }),
      ).toBe(false);
      expect(
        await store.meta.appendRoster({ seq: 1, prev: "h0", hash: "h1", entry: "e1", keys: [] }),
      ).toBe(true);
      expect(await store.meta.rosterAfter(-1, 10)).toEqual(["e0", "e1"]);
      expect(await store.meta.rosterAfter(0, 10)).toEqual(["e1"]);
      expect(await store.meta.rosterAfter(-1, 1)).toEqual(["e0"]);
      expect(await store.meta.getKey(0, "d1")).toEqual(bytes(1, 2));
      expect(await store.meta.getKey(1, "d1")).toBeUndefined();
    });

    test("a failed roster append stores none of its keys", async () => {
      await store.meta.appendRoster({ seq: 0, prev: undefined, hash: "h0", entry: "e0", keys: [] });
      const keys = [{ epoch: 1, name: "d1", data: bytes(9) }];
      expect(
        await store.meta.appendRoster({ seq: 1, prev: "wrong", hash: "h1", entry: "e1", keys }),
      ).toBe(false);
      expect(await store.meta.getKey(1, "d1")).toBeUndefined();
    });

    test("objects are immutable and listed in arrival order", async () => {
      expect(await store.meta.putObject(record("p1", "a"))).toBe("created");
      expect(await store.meta.putObject(record("p1", "a"))).toBe("identical");
      expect(await store.meta.putObject(record("p1", "b"))).toBe("conflict");
      await store.meta.putObject(record("p2", "b", 5));
      expect(await store.meta.getObject("p1")).toEqual(record("p1", "a"));
      expect(await store.meta.usage()).toEqual({ bytes: 15, objects: 2 });
      const changes = await store.meta.changesAfter(0, 10);
      expect(changes.map((c) => c.path)).toEqual(["p1", "p2"]);
      expect(await store.meta.changesAfter(changes[0]?.cursor ?? 0, 10)).toHaveLength(1);
      expect(await store.meta.changesAfter(0, 1)).toHaveLength(1);
    });

    test("deleted objects free their hash and never reuse a cursor", async () => {
      await store.meta.putObject(record("p1", "a"));
      const [first] = await store.meta.changesAfter(0, 10);
      expect(await store.meta.deleteObject("p1")).toEqual(record("p1", "a"));
      expect(await store.meta.deleteObject("p1")).toBeUndefined();
      expect(await store.meta.isHashUsed("a")).toBe(false);
      await store.meta.putObject(record("p1", "a"));
      const [second] = await store.meta.changesAfter(0, 10);
      expect(second?.cursor).toBeGreaterThan(first?.cursor ?? 0);
      expect(await store.meta.isHashUsed("a")).toBe(true);
    });

    test("devices record when they were last seen", async () => {
      await store.meta.touchDevice("d1", 5);
      await store.meta.touchDevice("d1", 9);
      await store.meta.touchDevice("d2", 7);
      expect(await store.meta.devices()).toEqual({ d1: 9, d2: 7 });
    });

    test("challenges are taken once and expire", async () => {
      await store.meta.putChallenge("c1", "d1", 100);
      await store.meta.putChallenge("c2", "d1", 50);
      expect(await store.meta.takeChallenge("c1")).toEqual({ did: "d1", expires: 100 });
      expect(await store.meta.takeChallenge("c1")).toBeUndefined();
      await store.meta.purgeExpired(60);
      expect(await store.meta.takeChallenge("c2")).toBeUndefined();
    });

    test("pairing slots are capped, immutable and expire with their messages", async () => {
      expect(await store.meta.openSlot("s1", 100, 2, 0)).toBe(true);
      expect(await store.meta.openSlot("s1", 100, 2, 0)).toBe(false);
      expect(await store.meta.openSlot("s2", 50, 2, 0)).toBe(true);
      expect(await store.meta.openSlot("s3", 100, 2, 0)).toBe(false);
      expect(await store.meta.slotExpiry("s1")).toBe(100);
      expect(await store.meta.putPairMessage("s1", "a-0", bytes(1))).toBe("created");
      expect(await store.meta.putPairMessage("s1", "a-0", bytes(1))).toBe("identical");
      expect(await store.meta.putPairMessage("s1", "a-0", bytes(2))).toBe("conflict");
      expect(await store.meta.getPairMessage("s1", "a-0")).toEqual(bytes(1));
      await store.meta.putPairMessage("s2", "a-0", bytes(3));
      await store.meta.purgeExpired(60);
      expect(await store.meta.slotExpiry("s2")).toBeUndefined();
      expect(await store.meta.getPairMessage("s2", "a-0")).toBeUndefined();
      expect(await store.meta.openSlot("s3", 100, 2, 60)).toBe(true);
      await store.meta.deleteSlot("s1");
      expect(await store.meta.getPairMessage("s1", "a-0")).toBeUndefined();
    });

    test("join requests are capped, answered once and expire", async () => {
      const request = (id: string, expires: number) => ({ id, name: `Phone ${id}`, expires });
      expect(await store.meta.addJoinRequest(request("j1", 100), 2, 0)).toBe(true);
      expect(await store.meta.addJoinRequest(request("j1", 100), 2, 0)).toBe(false);
      expect(await store.meta.addJoinRequest(request("j2", 50), 2, 0)).toBe(true);
      expect(await store.meta.addJoinRequest(request("j3", 100), 2, 0)).toBe(false);
      expect(await store.meta.openJoinRequests(0)).toEqual([request("j2", 50), request("j1", 100)]);
      expect(await store.meta.joinAnswer("j1", 0)).toEqual({ code: undefined, declined: false });
      expect(await store.meta.answerJoinRequest("j1", "code", 0)).toBe(true);
      expect(await store.meta.answerJoinRequest("j1", "other", 0)).toBe(false);
      expect(await store.meta.declineJoinRequest("j1", 0)).toBe(false);
      expect(await store.meta.joinAnswer("j1", 0)).toEqual({ code: "code", declined: false });
      expect(await store.meta.openJoinRequests(0)).toEqual([request("j2", 50)]);
      expect(await store.meta.hasJoinRequest("j2", 60)).toBe(false);
      expect(await store.meta.answerJoinRequest("j2", "code", 60)).toBe(false);
      expect(await store.meta.joinAnswer("j2", 60)).toBeUndefined();
      await store.meta.purgeExpired(60);
      expect(await store.meta.addJoinRequest(request("j3", 100), 2, 60)).toBe(true);
    });

    test("a declined join request stays declined until it expires", async () => {
      const request = (id: string) => ({ id, name: `Phone ${id}`, expires: 100 });
      expect(await store.meta.addJoinRequest(request("j1"), 1, 0)).toBe(true);
      expect(await store.meta.declineJoinRequest("j1", 0)).toBe(true);
      expect(await store.meta.declineJoinRequest("j1", 0)).toBe(false);
      expect(await store.meta.answerJoinRequest("j1", "code", 0)).toBe(false);
      expect(await store.meta.openJoinRequests(0)).toEqual([]);
      expect(await store.meta.joinAnswer("j1", 0)).toEqual({ code: undefined, declined: true });
      expect(await store.meta.addJoinRequest(request("j2"), 1, 0)).toBe(true);
      expect(await store.meta.joinAnswer("j1", 100)).toBeUndefined();
    });

    test("reset keeps only the named settings", async () => {
      await store.meta.setSettingOnce("instance", "i");
      await store.meta.setSettingOnce("group", "g");
      await store.meta.appendRoster({ seq: 0, prev: undefined, hash: "h0", entry: "e0", keys: [] });
      await store.meta.putObject(record("p1", "a"));
      await store.blobs.put("a", bytes(1));
      await store.meta.reset(["instance"]);
      expect(await store.blobs.get("a")).toEqual(bytes(1));
      expect(await store.meta.getSetting("instance")).toBe("i");
      expect(await store.meta.getSetting("group")).toBeUndefined();
      expect(await store.meta.rosterAfter(-1, 10)).toEqual([]);
      expect(await store.meta.usage()).toEqual({ bytes: 0, objects: 0 });
    });

    test("blobs are stored by hash", async () => {
      await store.blobs.put("a", bytes(1, 2, 3));
      await store.blobs.put("a", bytes(1, 2, 3));
      expect(await store.blobs.get("a")).toEqual(bytes(1, 2, 3));
      await store.blobs.delete("a");
      expect(await store.blobs.get("a")).toBeUndefined();
    });

    test("clearing blobs deletes every one", async () => {
      await store.blobs.put("a", bytes(1));
      await store.blobs.put("b", bytes(2));
      await store.blobs.clear();
      expect(await store.blobs.get("a")).toBeUndefined();
      expect(await store.blobs.get("b")).toBeUndefined();
    });
  });
}
