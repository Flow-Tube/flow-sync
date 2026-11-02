import fc from "fast-check";
import { expect, test } from "vitest";
import { utf8 } from "./bytes.ts";
import { blobPath, logPath, parseDevicePath } from "./paths.ts";
import { fuzzRuns, mutations } from "./testing/fuzz.ts";

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

test("any path that parses names exactly that path", () => {
  const id = "0123456789abcdef".repeat(2);
  const valid = [logPath(id, 1025), blobPath(id, "ab".repeat(32))].map((p) => utf8(p));
  const changed = fc
    .constantFrom(...valid)
    .chain(mutations)
    .map((bytes) => new TextDecoder().decode(bytes));
  fc.assert(
    fc.property(fc.oneof(fc.string(), changed), (input) => {
      const parsed = parseDevicePath(input);
      if (!parsed) return;
      const again =
        parsed.kind === "log" ? logPath(parsed.did, parsed.seq) : blobPath(parsed.did, parsed.hash);
      expect(again).toBe(input);
    }),
    fuzzRuns(),
  );
});
