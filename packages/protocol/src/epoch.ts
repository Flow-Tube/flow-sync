import { open, seal } from "./box.ts";
import { concat, equalBytes, u32 } from "./bytes.ts";
import { fail } from "./errors.ts";
import { derive, tag } from "./kdf.ts";

export type Purpose = "roster" | "changes" | "snapshot" | "ack" | "live" | "lan" | "chain" | "store";

export function epochCommitment(epochKey: Uint8Array, group: Uint8Array, epoch: number) {
  return derive(epochKey, group, "epoch", u32(epoch), 32);
}

export function purposeKey(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  purpose: Purpose,
): Uint8Array {
  return derive(epochKey, group, `key ${purpose}`, u32(epoch), 32);
}

export function checkEpochKey(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  commitment: Uint8Array,
): void {
  if (!equalBytes(epochCommitment(epochKey, group, epoch), commitment)) fail("key-commitment");
}

const chainAad = (group: Uint8Array, epoch: number) => concat(tag("chain"), group, u32(epoch));

/** Seals K_(e-1) under epoch e so members can read older objects. */
export function sealChain(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  previousKey: Uint8Array,
  salt?: Uint8Array,
): Uint8Array {
  const key = purposeKey(epochKey, group, epoch, "chain");
  return seal(key, chainAad(group, epoch), previousKey, salt);
}

export function openChain(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  box: Uint8Array,
): Uint8Array {
  return open(purposeKey(epochKey, group, epoch, "chain"), chainAad(group, epoch), box);
}
