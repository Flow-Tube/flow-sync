import { gcm } from "@noble/ciphers/aes.js";
import { concat, EMPTY, equalBytes, randomBytes } from "./bytes.ts";
import { fail } from "./errors.ts";
import { derive } from "./kdf.ts";

const SALT = 32;
const COMMIT = 32;
const TAG = 16;
export const BOX_OVERHEAD = SALT + COMMIT + TAG;

function boxKeys(key: Uint8Array, salt: Uint8Array) {
  const okm = derive(key, salt, "box", EMPTY, 76);
  return { aesKey: okm.subarray(0, 32), nonce: okm.subarray(32, 44), commit: okm.subarray(44) };
}

/** `salt` is only passed explicitly to reproduce test vectors. */
export function seal(
  key: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  salt: Uint8Array = randomBytes(SALT),
): Uint8Array {
  const { aesKey, nonce, commit } = boxKeys(key, salt);
  return concat(salt, commit, gcm(aesKey, nonce, aad).encrypt(plaintext));
}

export function open(key: Uint8Array, aad: Uint8Array, box: Uint8Array): Uint8Array {
  if (box.length < BOX_OVERHEAD) fail("length");
  const { aesKey, nonce, commit } = boxKeys(key, box.subarray(0, SALT));
  if (!equalBytes(commit, box.subarray(SALT, SALT + COMMIT))) fail("commitment");
  try {
    return gcm(aesKey, nonce, aad).decrypt(box.subarray(SALT + COMMIT));
  } catch {
    fail("decrypt");
  }
}
