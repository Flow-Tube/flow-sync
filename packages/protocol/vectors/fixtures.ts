import { derive, EMPTY, memberSecrets, recoveryKeys, toHex, utf8 } from "../src/index.ts";

/** Deterministic stand-in for the CSPRNG, so every run reproduces the same vectors. */
export function rand(label: string, length = 32): Uint8Array {
  return derive(utf8("flow-sync test vectors"), EMPTY, `vector ${label}`, EMPTY, length);
}

export const hex = toHex;
export const group = rand("group", 16);
export const epochKeys = [0, 1, 2, 3, 4].map((n) => rand(`epoch ${n}`));
export const device = {
  A: memberSecrets(rand("A sig"), rand("A kem")),
  B: memberSecrets(rand("B sig"), rand("B kem")),
  C: memberSecrets(rand("C sig"), rand("C kem")),
};
export const recoverySecrets = [rand("recovery 1"), rand("recovery 2")];
export const recovery = recoverySecrets.map(recoveryKeys);

/** Flips one bit so a vector can show the exact check that rejects it. */
export function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] as number) ^ 0x01;
  return copy;
}

export type Vectors = Record<string, unknown>;
