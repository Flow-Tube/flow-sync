import { equalBytes } from "@noble/ciphers/utils.js";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import { fail } from "./errors.ts";

export {
  bytesToHex as toHex,
  concatBytes as concat,
  equalBytes,
  hexToBytes as fromHex,
  randomBytes,
  utf8ToBytes as utf8,
};

export const EMPTY = new Uint8Array(0);
export const toB64 = base64urlnopad.encode;
export const fromB64 = base64urlnopad.decode;

export function u8(n: number): Uint8Array {
  return Uint8Array.of(n);
}

export function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

export function u64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n));
  return out;
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

export function readU64(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = view.getBigUint64(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("range");
  return Number(value);
}
