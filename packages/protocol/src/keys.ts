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

export function memberSecrets(sigSeed: Uint8Array, kemSecret: Uint8Array): MemberSecrets {
  const sigPublic = signingPublicKey(sigSeed);
  const kemPublic = agreementPublicKey(kemSecret);
  return { sigSeed, kemSecret, sigPublic, kemPublic, did: memberId(sigPublic, kemPublic) };
}
