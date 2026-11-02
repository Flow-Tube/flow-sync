import fc from "fast-check";
import { test } from "vitest";
import { randomBytes } from "./bytes.ts";
import { memberSecrets } from "./keys.ts";
import { fuzzRuns, mutations, refused } from "./testing/fuzz.ts";
import { unwrapEpochKey, wrapEpochKey } from "./wrap.ts";

const group = randomBytes(16);
const member = memberSecrets(randomBytes(32), randomBytes(32));

test("any change to a wrapped epoch key is refused", async () => {
  const wrap = await wrapEpochKey(member.kemPublic, group, 0, member.did, randomBytes(32));
  await fc.assert(
    fc.asyncProperty(mutations(wrap), (changed) =>
      refused(() => unwrapEpochKey(member.kemSecret, group, 0, member.did, changed)),
    ),
    fuzzRuns(30),
  );
});

test("arbitrary wraps are refused", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ minLength: 80, maxLength: 80 }), (wrap) =>
      refused(() => unwrapEpochKey(member.kemSecret, group, 0, member.did, wrap)),
    ),
    fuzzRuns(30),
  );
});
