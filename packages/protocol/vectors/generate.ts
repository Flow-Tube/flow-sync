import { writeFile } from "node:fs/promises";
import { envelopeVectors } from "./envelope.ts";
import type { Vectors } from "./fixtures.ts";
import { forkVectors } from "./forks.ts";
import { keyVectors, recoveryVectors } from "./keys.ts";
import { lanVectors, pairingVectors } from "./pairing.ts";
import {
  boxVectors,
  canonicalVectors,
  deriveVectors,
  ed25519Vectors,
  payloadVectors,
} from "./primitives.ts";
import { rosterVectors } from "./roster.ts";
import { senderVectors } from "./senders.ts";

export const VECTORS_DIR = new URL("../../../spec/vectors/", import.meta.url);

export async function buildVectors(): Promise<Record<string, Vectors>> {
  return {
    canonical: canonicalVectors(),
    derive: deriveVectors(),
    ed25519: ed25519Vectors(),
    box: boxVectors(),
    payload: payloadVectors(),
    keys: await keyVectors(),
    recovery: recoveryVectors(),
    envelope: envelopeVectors(),
    roster: rosterVectors(),
    forks: forkVectors(),
    senders: senderVectors(),
    pairing: pairingVectors(),
    lan: lanVectors(),
  };
}

export const serialize = (vectors: Vectors) => `${JSON.stringify(vectors, null, 2)}\n`;

if (import.meta.main) {
  for (const [name, vectors] of Object.entries(await buildVectors())) {
    await writeFile(new URL(`${name}.json`, VECTORS_DIR), serialize(vectors));
  }
}
