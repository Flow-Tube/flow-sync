import fc from "fast-check";
import { test } from "vitest";
import { randomBytes } from "./bytes.ts";
import { checkEpochKey, epochCommitment, openChain, sealChain } from "./epoch.ts";
import { fuzzRuns, mutations, refused } from "./testing/fuzz.ts";

const group = randomBytes(16);
const epochKey = randomBytes(32);

test("any change to a history chain box is refused", async () => {
  const box = sealChain(epochKey, group, 1, randomBytes(32));
  await fc.assert(
    fc.asyncProperty(mutations(box), (changed) =>
      refused(() => openChain(epochKey, group, 1, changed)),
    ),
    fuzzRuns(),
  );
});

test("a wrong epoch key never matches the commitment", async () => {
  const commitment = epochCommitment(epochKey, group, 2);
  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), (other) =>
      refused(() => checkEpochKey(other, group, 2, commitment)),
    ),
    fuzzRuns(),
  );
});
