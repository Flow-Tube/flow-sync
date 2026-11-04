import { concat } from "./bytes.ts";
import { agreementPublicKey, signingPublicKey } from "./curve.ts";
import { labeledHash } from "./kdf.ts";

export interface MemberKeys {
  sigPublic: Uint8Array;
  kemPublic: Uint8Array;
  did: Uint8Array;
}

export interface MemberSecrets extends MemberKeys {
  sigSeed: Uint8Array;
  kemSecret: Uint8Array;
}

export function memberId(sigPublic: Uint8Array, kemPublic: Uint8Array): Uint8Array {
  return labeledHash("device", concat(sigPublic, kemPublic)).subarray(0, 16);
}

/** The id of a group: it commits to the keys of its genesis, so a store can't write a rival one. */
export function groupId(
  device: Pick<MemberKeys, "sigPublic" | "kemPublic">,
  recovery: Pick<MemberKeys, "sigPublic" | "kemPublic">,
): Uint8Array {
  return labeledHash(
    "group",
    concat(device.sigPublic, device.kemPublic, recovery.sigPublic, recovery.kemPublic),
  ).subarray(0, 16);
}

export function memberSecrets(sigSeed: Uint8Array, kemSecret: Uint8Array): MemberSecrets {
  const sigPublic = signingPublicKey(sigSeed);
  const kemPublic = agreementPublicKey(kemSecret);
  return { sigSeed, kemSecret, sigPublic, kemPublic, did: memberId(sigPublic, kemPublic) };
}
