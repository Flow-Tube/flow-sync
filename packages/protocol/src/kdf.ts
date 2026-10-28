import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, utf8 } from "./bytes.ts";

const SEPARATOR = Uint8Array.of(0);

/** The protocol prefix for labels used as AAD or signature context. */
export function tag(label: string): Uint8Array {
  return utf8(`FLOW-SYNC/2 ${label}`);
}

export function derive(
  ikm: Uint8Array,
  salt: Uint8Array,
  label: string,
  context: Uint8Array,
  length: number,
): Uint8Array {
  return expand(sha256, extract(sha256, ikm, salt), concat(tag(label), SEPARATOR, context), length);
}

export function labeledHash(label: string, data: Uint8Array): Uint8Array {
  return sha256(concat(tag(label), SEPARATOR, data));
}

export { sha256 };
