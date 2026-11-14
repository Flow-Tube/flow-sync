import fc from "fast-check";
import { expect, test } from "vitest";
import { randomBytes, toHex, utf8 } from "./bytes.ts";
import { canonical, type Json } from "./canonical.ts";
import { buildEntry, epochDraft, memberSubject } from "./entries.ts";
import { FlowSyncError } from "./errors.ts";
import { groupId, memberSecrets } from "./keys.ts";
import { applyEntry, type Entry, entryHash, parseEntry } from "./roster.ts";
import { fuzzRuns, mutations, refused } from "./testing/fuzz.ts";

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

const member = () => memberSecrets(randomBytes(32), randomBytes(32));
const [device, recovery, joiner] = [member(), member(), member()];
const group = groupId(device, recovery);
const genesis = buildEntry(
  group,
  undefined,
  {
    op: "genesis",
    signer: toHex(device.did),
    add: [memberSubject(device, "device"), memberSubject(recovery, "recovery")],
    epoch: epochDraft(randomBytes(32), group, 0, [device, recovery]),
  },
  [device, recovery],
);
const state = applyEntry(undefined, genesis);
const add = buildEntry(
  group,
  { seq: 0, head: toHex(entryHash(genesis)) },
  { op: "add", signer: toHex(device.did), add: [memberSubject(joiner, "device")] },
  [device, joiner],
);

const isUnchanged = (value: unknown) => {
  try {
    return canonical(value as Json) === canonical(add as Json);
  } catch {
    return false;
  }
};

/** Parses changed entry text the way a store response is read, then applies it after genesis. */
const applyText = async (text: string) => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (isUnchanged(value)) return;
  await refused(() => applyEntry(state, parseEntry(value)));
};

test("any change to the text of a signed entry is refused", async () => {
  await fc.assert(
    fc.asyncProperty(mutations(utf8(canonical(add as Json))), (changed) =>
      applyText(new TextDecoder().decode(changed)),
    ),
    fuzzRuns(),
  );
});

test("any changed, removed or added field of a signed entry is refused", async () => {
  const fields = Object.keys(add) as (keyof Entry)[];
  const edit = fc.oneof(
    fc.tuple(fc.constantFrom(...fields), fc.jsonValue()).map(([k, v]) => ({ ...add, [k]: v })),
    fc.constantFrom(...fields).map((k) => {
      const { [k]: _, ...rest } = add;
      return rest;
    }),
    fc.tuple(fc.string(), fc.jsonValue()).map(([k, v]) => ({ ...add, [k]: v })),
  );
  await fc.assert(
    fc.asyncProperty(edit, (changed) => applyText(JSON.stringify(changed))),
    fuzzRuns(),
  );
});

test("a meta value with a lone surrogate is refused, since it has no one UTF-8 form", () => {
  const entry = {
    v: 2,
    group: "00".repeat(16),
    seq: 1,
    prev: "00".repeat(32),
    op: "rename",
    signer: "00".repeat(16),
    meta: { ["00".repeat(16)]: "\ud800" },
    sigs: {},
  };
  expect(() => parseEntry(entry)).toThrow(FlowSyncError);
  expect(() => parseEntry({ ...entry, meta: { ["00".repeat(16)]: "AAAA" } })).not.toThrow();
});
