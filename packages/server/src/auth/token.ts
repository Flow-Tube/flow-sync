import { concat, equalBytes, fromB64, readU64, tag, toB64, toHex, u64 } from "@flow-sync/protocol";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const DID = 16;
const EXPIRES = 8;
const MAC = 32;

const mac = (secret: Uint8Array, body: Uint8Array) =>
  hmac(sha256, secret, concat(tag("token"), body));

/** A token is did ‖ expiry ‖ HMAC, so any server instance holding the secret can check it. */
export function issueToken(secret: Uint8Array, did: Uint8Array, expires: number): string {
  const body = concat(did, u64(expires));
  return toB64(concat(body, mac(secret, body)));
}

export function readToken(
  secret: Uint8Array,
  token: string,
  now: number,
): { did: string; expires: number } | undefined {
  let bytes: Uint8Array;
  try {
    bytes = fromB64(token);
  } catch {
    return undefined;
  }
  if (bytes.length !== DID + EXPIRES + MAC) return undefined;
  const body = bytes.subarray(0, DID + EXPIRES);
  if (!equalBytes(mac(secret, body), bytes.subarray(DID + EXPIRES))) return undefined;
  const expires = readU64(bytes, DID);
  return expires > now ? { did: toHex(bytes.subarray(0, DID)), expires } : undefined;
}
