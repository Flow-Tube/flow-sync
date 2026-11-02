import fc from "fast-check";
import { expect, test } from "vitest";
import { canonical } from "./canonical.ts";

test("keys come out in UTF-16 code unit order", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string({ unit: "grapheme" }), { maxLength: 8 }), (keys) => {
      const value = Object.fromEntries(keys.map((k, i) => [k, i]));
      const order = Object.keys(JSON.parse(canonical(value)));
      for (let i = 1; i < order.length; i++) {
        const [a, b] = [order[i - 1] as string, order[i] as string];
        const first = [...Array(Math.min(a.length, b.length)).keys()].find(
          (j) => a.charCodeAt(j) !== b.charCodeAt(j),
        );
        if (first === undefined) expect(a.length).toBeLessThan(b.length);
        else expect(a.charCodeAt(first)).toBeLessThan(b.charCodeAt(first));
      }
    }),
  );
});
