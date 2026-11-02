import fc from "fast-check";
import { test } from "vitest";
import { fromB64, randomBytes } from "./bytes.ts";
import { openDeviceMeta, sealDeviceMeta } from "./entries.ts";
import { fuzzRuns, mutations, refused } from "./testing/fuzz.ts";

const group = randomBytes(16);
const did = randomBytes(16);
const epochKey = randomBytes(32);

test("any change to a sealed device name is refused", async () => {
  const meta = { app: "flow", name: "Phone", platform: "android" };
  const box = fromB64(sealDeviceMeta(epochKey, group, 0, 3, did, meta));
  await fc.assert(
    fc.asyncProperty(mutations(box), (changed) =>
      refused(() => openDeviceMeta(epochKey, group, 0, 3, did, changed)),
    ),
    fuzzRuns(),
  );
});
