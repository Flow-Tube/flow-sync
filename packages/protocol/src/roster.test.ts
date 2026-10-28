import fc from "fast-check";
import { expect, test } from "vitest";
import { canonical, type Json } from "./canonical.ts";
import { FlowSyncError } from "./errors.ts";
import { parseEntry } from "./roster.ts";

test("canonical JSON parses back to the same value", () => {
  const json = fc.jsonValue().map((value) => JSON.parse(JSON.stringify(value)) as Json);
  fc.assert(
    fc.property(json, (value) => {
      try {
        expect(JSON.parse(canonical(value))).toEqual(value);
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
      }
    }),
  );
});

test("arbitrary JSON is rejected as a roster entry with a protocol error", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (value) => {
      try {
        parseEntry(value);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(FlowSyncError);
      }
    }),
  );
});
