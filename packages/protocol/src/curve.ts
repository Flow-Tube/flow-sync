import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { fail } from "./errors.ts";

/** Rejects non-canonical encodings and the small-order keys listed in crypto.md. */
export function isValidSigningKey(publicKey: Uint8Array): boolean {
  try {
    return publicKey.length === 32 && !ed25519.Point.fromBytes(publicKey).isSmallOrder();
  } catch {
    return false;
  }
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
    isValidSigningKey(publicKey) && ed25519.verify(signature, message, publicKey, { zip215: false })
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
