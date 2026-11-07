import fc from "fast-check";
import { expect, test } from "vitest";
import { canonical } from "./canonical.ts";

function byCodeUnit(a: string, b: string): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
  }
  return a.length - b.length;
}

// Compared as text: a parsed object lists integer-like keys first, whatever order they came in.
test("keys come out in UTF-16 code unit order", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string({ unit: "grapheme" }), { maxLength: 8 }), (keys) => {
      const fields = keys.map((k, i) => [k, i] as const);
      const expected = [...fields]
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([k, i]) => `${JSON.stringify(k)}:${i}`);
      expect(canonical(Object.fromEntries(fields))).toBe(`{${expected.join(",")}}`);
    }),
  );
});

test("integer-like keys sort as strings", () => {
  expect(canonical({ "9": 0, "10": 1, "": 2, "0": 3 })).toBe('{"":2,"0":3,"10":1,"9":0}');
});
