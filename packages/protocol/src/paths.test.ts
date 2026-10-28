import fc from "fast-check";
import { expect, test } from "vitest";
import { blobPath, logPath, parseDevicePath } from "./paths.ts";

const did = fc.stringMatching(/^[0-9a-f]{32}$/);

test("log and blob paths round-trip", () => {
  fc.assert(
    fc.property(did, fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (id, seq) => {
      expect(parseDevicePath(logPath(id, seq))).toEqual({ kind: "log", did: id, seq });
    }),
  );
  fc.assert(
    fc.property(did, fc.stringMatching(/^[0-9a-f]{64}$/), (id, hash) => {
      expect(parseDevicePath(blobPath(id, hash))).toEqual({ kind: "blob", did: id, hash });
    }),
  );
});

test("other paths are refused", () => {
  const id = "0".repeat(32);
  for (const path of [
    `dev/${id}/log/0000000000000001/0000000000000001.o`,
    `dev/${id}/log/0000000000000000/0000000000000001.O`,
    `dev/${id}/../roster/0000000000000000.o`,
    `dev/${id}/log/0000000000000000/ffffffffffffffff.o`,
    `roster/0000000000000000-0000000000000000.r`,
  ]) {
    expect(parseDevicePath(path)).toBeUndefined();
  }
});
