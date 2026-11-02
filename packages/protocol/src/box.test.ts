import fc from "fast-check";
import { test } from "vitest";
import { open, seal } from "./box.ts";
import { randomBytes, utf8 } from "./bytes.ts";
import { fuzzRuns, mutations, refused, refusedCleanly } from "./testing/fuzz.ts";

const key = randomBytes(32);
const aad = utf8("aad");
const box = seal(key, aad, randomBytes(100));

test("any change to a box is refused", async () => {
  await fc.assert(
    fc.asyncProperty(mutations(box), (changed) => refused(() => open(key, aad, changed))),
    fuzzRuns(),
  );
});

test("arbitrary keys, AAD and boxes are refused cleanly", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.uint8Array({ maxLength: 64 }),
      fc.uint8Array({ maxLength: 512 }),
      (k, a, b) => refusedCleanly(() => open(k, a, b)),
    ),
    fuzzRuns(),
  );
});
