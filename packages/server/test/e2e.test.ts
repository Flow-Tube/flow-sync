import {
  buildEntry,
  type Entry,
  epochDraft,
  type MemberSecrets,
  memberSecrets,
  memberSubject,
  ObjectType,
  randomBytes,
  recoveryKeys,
  recoverySecret,
  recoveryWords,
  sealChain,
  sha256,
  toB64,
  toHex,
  wrapEpochKey,
} from "@flow-sync/protocol";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ADMIN_TOKEN, testApp } from "../src/testing/app.ts";
import { closeServers, serveLive } from "../src/testing/live.ts";
import { SimDevice } from "./device.ts";
import { pairThroughMailbox } from "./pairing.ts";

const newKeys = () => memberSecrets(randomBytes(32), randomBytes(32));
let base = "";
let harness: ReturnType<typeof testApp>;

beforeAll(async () => {
  harness = testApp();
  base = `http://127.0.0.1:${await serveLive(harness)}`;
});
afterAll(closeServers);

/** Appends an entry that starts a new epoch, wrapping a fresh key to every member it names. */
async function startEpoch(
  device: SimDevice,
  draft: Parameters<typeof buildEntry>[2],
  members: MemberSecrets[],
  signers: MemberSecrets[],
) {
  const state = await device.syncRoster();
  const n = state.epoch + 1;
  const key = randomBytes(32);
  const entry = buildEntry(
    device.group,
    state,
    { ...draft, epoch: epochDraft(key, device.group, n, members) },
    signers,
  );
  const wraps: Record<string, string> = {};
  for (const m of members)
    wraps[toHex(m.did)] = toB64(await wrapEpochKey(m.kemPublic, device.group, n, m.did, key));
  const chain = toB64(sealChain(key, device.group, n, device.epochKey(state.epoch)));
  const res = await device.fetch("/v1/roster", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `"${state.head}"` },
    body: JSON.stringify({ entry, wraps, chain }),
  });
  if (res.status === 201) device.learnEpochKey(n, key);
  return res;
}

test("two devices pair, sync, survive a hostile store, remove and recover", async () => {
  // A creates the group with a recovery key and claims the instance.
  const words = recoveryWords(randomBytes(32));
  const recovery = recoveryKeys(recoverySecret(words));
  const a = new SimDevice(base, newKeys());
  a.group = randomBytes(16);
  const k0 = randomBytes(32);
  const genesis = buildEntry(
    a.group,
    undefined,
    {
      op: "genesis",
      signer: a.did,
      add: [memberSubject(a.keys, "device"), memberSubject(recovery, "recovery")],
      epoch: epochDraft(k0, a.group, 0, [a.keys, recovery]),
    },
    [a.keys, recovery],
  );
  const wraps: Record<string, string> = {};
  for (const m of [a.keys, recovery])
    wraps[toHex(m.did)] = toB64(await wrapEpochKey(m.kemPublic, a.group, 0, m.did, k0));
  const claim = await fetch(`${base}/v1/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ entry: genesis, wraps }),
  });
  expect(claim.status).toBe(201);
  await a.signIn();
  await a.unwrapCurrent();

  // B pairs through the mailbox; both screens show the same code.
  const b = new SimDevice(base, newKeys());
  const { showerSas, scannerSas } = await pairThroughMailbox(a, b, base);
  expect(showerSas).toBe(scannerSas);

  // Sync both ways, in stream order.
  expect((await a.write("history 1")).status).toBe(201);
  expect((await a.write("history 2")).status).toBe(201);
  expect(await b.read()).toEqual(["history 1", "history 2"]);
  expect((await b.write('{"vv":{}}', ObjectType.ack)).status).toBe(201);
  expect(await a.read()).toEqual(['{"vv":{}}']);

  // A hostile store swaps an object's bytes, or serves an old object under a new name.
  expect((await a.write("history 3")).status).toBe(201);
  const third = `dev/${a.did}/log/0000000000000000/0000000000000003.o`;
  const record = await harness.storage.meta.getObject(third);
  const original = await harness.storage.blobs.get(record?.hash ?? "");
  const tampered = (original as Uint8Array).slice();
  tampered[120] = (tampered[120] as number) ^ 1;
  await harness.storage.blobs.delete(record?.hash ?? "");
  await harness.storage.blobs.put(record?.hash ?? "", tampered);
  await expect(b.read()).rejects.toThrow("signature");
  const first = await harness.storage.meta.getObject(
    `dev/${a.did}/log/0000000000000000/0000000000000001.o`,
  );
  await harness.storage.blobs.delete(record?.hash ?? "");
  await harness.storage.blobs.put(
    record?.hash ?? "",
    (await harness.storage.blobs.get(first?.hash ?? "")) as Uint8Array,
  );
  await expect(b.read()).rejects.toThrow("replayed object");
  await harness.storage.blobs.delete(record?.hash ?? "");
  await harness.storage.blobs.put(record?.hash ?? "", original as Uint8Array);
  expect(await b.read()).toEqual(["history 3"]);
  expect(toHex(sha256(original as Uint8Array))).toBe(record?.hash);

  // A removes B: a new epoch B never receives, and the server refuses B at once.
  const removed = await startEpoch(
    a,
    { op: "remove", signer: a.did, remove: [b.did] },
    [a.keys, recovery],
    [a.keys],
  );
  expect(removed.status).toBe(201);
  await expect(b.syncRoster()).rejects.toThrow("401");
  const k1 = await a.unwrapCurrent();
  expect(toHex(await a.readChain(1))).toBe(toHex(k0));
  expect((await a.write("after removal")).status).toBe(201);
  await expect(b.unwrapCurrent()).rejects.toThrow();
  expect(k1).not.toEqual(k0);

  // D restores the group from the recovery words, then replaces the recovery key.
  const restoring = new SimDevice(base, recoveryKeys(recoverySecret(words)));
  await restoring.signIn();
  await restoring.unwrapCurrent();
  const d = new SimDevice(base, newKeys());
  const restore = await startEpoch(
    restoring,
    { op: "restore", signer: restoring.did, add: [memberSubject(d.keys, "device")] },
    [a.keys, d.keys, recovery],
    [recovery, d.keys],
  );
  expect(restore.status).toBe(201);
  await d.signIn();
  await d.unwrapCurrent();
  const again = await startEpoch(
    restoring,
    { op: "restore", signer: restoring.did, add: [memberSubject(newKeys(), "device")] },
    [a.keys, d.keys, recovery],
    [recovery],
  );
  expect(again.status).toBe(400);
  const nextRecovery = recoveryKeys(randomBytes(32));
  const replaced = await startEpoch(
    d,
    {
      op: "recovery",
      signer: d.did,
      remove: [toHex(recovery.did)],
      add: [memberSubject(nextRecovery, "recovery")],
    },
    [a.keys, d.keys, nextRecovery],
    [d.keys, nextRecovery],
  );
  expect(replaced.status).toBe(201);
  await d.unwrapCurrent();
  expect((await d.write("restored device")).status).toBe(201);
  await a.unwrapCurrent();
  expect(await a.read()).toEqual(["restored device"]);
  const entries = (await a.json<{ entries: Entry[] }>("/v1/roster")).entries.map((e) => e.op);
  expect(entries).toEqual(["genesis", "add", "remove", "restore", "recovery"]);
});
