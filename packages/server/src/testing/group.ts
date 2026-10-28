import {
  buildEntry,
  epochDraft,
  memberSecrets,
  memberSubject,
  randomBytes,
  recoveryKeys,
  toB64,
  toHex,
  wrapEpochKey,
} from "@flow-sync/protocol";

export const newDevice = () => memberSecrets(randomBytes(32), randomBytes(32));

/** A fresh group with one device and a recovery key, ready to claim an instance. */
export async function genesis() {
  const group = randomBytes(16);
  const device = newDevice();
  const recovery = recoveryKeys(randomBytes(32));
  const epochKey = randomBytes(32);
  const entry = buildEntry(
    group,
    undefined,
    {
      op: "genesis",
      signer: toHex(device.did),
      add: [memberSubject(device, "device"), memberSubject(recovery, "recovery")],
      epoch: epochDraft(epochKey, group, 0, [device, recovery]),
    },
    [device, recovery],
  );
  const wraps: Record<string, string> = {};
  for (const member of [device, recovery]) {
    wraps[toHex(member.did)] = toB64(
      await wrapEpochKey(member.kemPublic, group, 0, member.did, epochKey),
    );
  }
  return { group, device, recovery, epochKey, entry, wraps };
}
