import {
  epochCommitment,
  type MemberSecrets,
  type Purpose,
  purposeKey,
  recoveryWords,
  sealChain,
  wrapEpochKey,
} from "../src/index.ts";
import {
  device,
  epochKeys,
  group,
  hex,
  rand,
  recovery,
  recoverySecrets,
  type Vectors,
} from "./fixtures.ts";

const PURPOSES: Purpose[] = ["roster", "changes", "snapshot", "ack", "live", "lan", "chain"];

const member = (name: string, m: MemberSecrets) => ({
  name,
  sigSeed: hex(m.sigSeed),
  kemSecret: hex(m.kemSecret),
  sigPublic: hex(m.sigPublic),
  kemPublic: hex(m.kemPublic),
  did: hex(m.did),
});

export async function keyVectors(): Promise<Vectors> {
  const k = epochKeys[3] as Uint8Array;
  const k0 = epochKeys[0] as Uint8Array;
  const k1 = epochKeys[1] as Uint8Array;
  const ikmE = rand("ikmE");
  const wrap = await wrapEpochKey(device.B.kemPublic, group, 3, device.B.did, k, ikmE);
  const chainSalt = rand("chain salt");
  return {
    members: Object.entries(device).map(([name, m]) => member(name, m)),
    epoch: {
      key: hex(k),
      group: hex(group),
      epoch: 3,
      commitment: hex(epochCommitment(k, group, 3)),
      purposes: Object.fromEntries(PURPOSES.map((p) => [p, hex(purposeKey(k, group, 3, p))])),
    },
    wrap: {
      kemSecret: hex(device.B.kemSecret),
      kemPublic: hex(device.B.kemPublic),
      group: hex(group),
      epoch: 3,
      did: hex(device.B.did),
      key: hex(k),
      ikmE: hex(ikmE),
      wrap: hex(wrap),
      negatives: [
        { name: "wrong-epoch", epoch: 2, did: hex(device.B.did), error: "decrypt" },
        { name: "wrong-member", epoch: 3, did: hex(device.A.did), error: "decrypt" },
      ],
    },
    chain: {
      key: hex(k1),
      group: hex(group),
      epoch: 1,
      previousKey: hex(k0),
      salt: hex(chainSalt),
      box: hex(sealChain(k1, group, 1, k0, chainSalt)),
    },
  };
}

export function recoveryVectors(): Vectors {
  const secret = recoverySecrets[0] as Uint8Array;
  const words = recoveryWords(secret);
  const swapped = words.split(" ");
  [swapped[0], swapped[1]] = [swapped[1] as string, swapped[0] as string];
  return {
    cases: [{ secret: hex(secret), words, ...member("recovery", recovery[0] as MemberSecrets) }],
    invalidWords: [
      swapped.join(" "),
      words.split(" ").slice(0, 23).join(" "),
      recoveryWords(secret.subarray(0, 16)),
    ],
  };
}
