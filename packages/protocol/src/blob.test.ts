import fc from "fast-check";
import { test } from "vitest";
import { openBlob, sealBlob } from "./blob.ts";
import { randomBytes } from "./bytes.ts";
import { sha256 } from "./kdf.ts";
import { fuzzRuns, mutations, refused } from "./testing/fuzz.ts";

const group = randomBytes(16);
const did = randomBytes(16);
const snapshotKey = randomBytes(32);

test("any change to a snapshot blob is refused, even with a matching name", async () => {
  const blob = sealBlob(snapshotKey, group, 0, did, randomBytes(300));
  await fc.assert(
    fc.asyncProperty(mutations(blob), (changed) =>
      refused(() => openBlob(snapshotKey, group, 0, did, changed, sha256(changed))),
    ),
    fuzzRuns(),
  );
});
