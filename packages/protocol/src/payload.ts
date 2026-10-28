import { Gunzip, gzipSync } from "fflate";
import { concat, readU32, u32 } from "./bytes.ts";
import { fail } from "./errors.ts";

const MIN_SIZE = 256;
const MAX_INFLATED = 64 * 1024 * 1024;

/** PADMÉ with a 256-byte floor; exact for sizes below 2^31. */
export function paddedSize(n: number): number {
  if (n <= MIN_SIZE) return MIN_SIZE;
  const e = 31 - Math.clz32(n);
  const s = 32 - Math.clz32(e);
  const mask = 2 ** (e - s) - 1;
  return (n + mask) & ~mask;
}

export function encodePayload(content: Uint8Array): Uint8Array {
  const body = gzipSync(content, { level: 9, mtime: 0 });
  const unpadded = 4 + body.length;
  return concat(u32(body.length), body, new Uint8Array(paddedSize(unpadded) - unpadded));
}

export function decodePayload(payload: Uint8Array): Uint8Array {
  if (payload.length < 4) fail("payload");
  const length = readU32(payload, 0);
  if (4 + length > payload.length) fail("payload");
  if (payload.subarray(4 + length).some((byte) => byte !== 0)) fail("payload");
  return inflate(payload.subarray(4, 4 + length));
}

function inflate(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let ended = false;
  const gunzip = new Gunzip((chunk, final) => {
    total += chunk.length;
    if (total > MAX_INFLATED) fail("payload");
    chunks.push(chunk);
    ended = final;
  });
  try {
    gunzip.push(body, true);
  } catch {
    fail("payload");
  }
  if (!ended) fail("payload");
  return concat(...chunks);
}
