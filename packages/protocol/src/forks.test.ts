import { expect, test } from "vitest";
import { randomBytes, toHex } from "./bytes.ts";
import { buildEntry, epochDraft, memberSubject } from "./entries.ts";
import { FlowSyncError } from "./errors.ts";
import { MAX_ROSTER_ENTRIES, resolveForks, settleRoster } from "./forks.ts";
import { groupId, memberSecrets } from "./keys.ts";
import { type Entry, entryHash } from "./roster.ts";

const member = () => memberSecrets(randomBytes(32), randomBytes(32));
const device = member();
const recovery = member();
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

function renames(count: number): Entry[] {
  const chain = [genesis];
  for (let i = 0; i < count; i++) {
    const last = chain[i] as Entry;
    chain.push(
      buildEntry(
        group,
        { seq: last.seq, head: toHex(entryHash(last)) },
        { op: "rename", signer: toHex(device.did), meta: { [toHex(device.did)]: "x" } },
        [device],
      ),
    );
  }
  return chain;
}

test("a view with no valid genesis settles nothing", () => {
  expect(() =>
    settleRoster({ group: toHex(randomBytes(16)), applied: [], view: [genesis] }),
  ).toThrow(FlowSyncError);
});

test("an applied entry that no longer validates settles nothing", () => {
  const tampered = { ...genesis, group: toHex(randomBytes(16)) };
  expect(() =>
    settleRoster({ group: tampered.group, applied: [tampered], view: [tampered] }),
  ).toThrow(FlowSyncError);
});

test("a roster past the limit of valid entries is refused", { timeout: 120_000 }, () => {
  const chain = renames(MAX_ROSTER_ENTRIES);
  expect(() => resolveForks(toHex(group), chain)).toThrow(FlowSyncError);
  expect(resolveForks(toHex(group), chain.slice(0, MAX_ROSTER_ENTRIES)).chain).toHaveLength(
    MAX_ROSTER_ENTRIES,
  );
});
