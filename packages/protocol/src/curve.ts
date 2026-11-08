import { ED25519_TORSION_SUBGROUP, ed25519, x25519 } from "@noble/curves/ed25519.js";
import { toHex } from "./bytes.ts";
import { fail } from "./errors.ts";

const SMALL_ORDER = new Set<string>(ED25519_TORSION_SUBGROUP);

function decodePoint(encoded: Uint8Array) {
  try {
    return encoded.length === 32 ? ed25519.Point.fromBytes(encoded) : undefined;
  } catch {
    return undefined;
  }
}

/** Canonical and not small order. A fraction of the cost of the full check below. */
export function isWellFormedSigningKey(publicKey: Uint8Array): boolean {
  const point = decodePoint(publicKey);
  return point !== undefined && !point.isSmallOrder();
}

/** Canonical and of order exactly L, the rule in crypto.md. Costs about 0.4 ms in pure JS. */
export function isValidSigningKey(publicKey: Uint8Array): boolean {
  const point = decodePoint(publicKey);
  return point !== undefined && !point.isSmallOrder() && point.isTorsionFree();
}

/** Whether these bytes are a canonical encoding of one of the eight small-order points. */
export function isSmallOrderEncoding(encoded: Uint8Array): boolean {
  return SMALL_ORDER.has(toHex(encoded));
}

export function signingPublicKey(seed: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(seed);
}

export function sign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, seed);
}

/** A signature check, for callers that run it with another Ed25519 implementation. */
export interface SignatureCheck {
  key: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return (
    isValidSigningKey(publicKey) &&
    isValidSigningKey(signature.subarray(0, 32)) &&
    ed25519.verify(signature, message, publicKey, { zip215: false })
  );
}

export function agreementPublicKey(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}

export function agree(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secret, publicKey);
  } catch {
    fail("x25519");
  }
  if (shared.every((byte) => byte === 0)) fail("x25519");
  return shared;
}
