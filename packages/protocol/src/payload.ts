import { gzipSync } from "fflate";
import { concat, readU32, u32 } from "./bytes.ts";
import { fail } from "./errors.ts";

const MIN_SIZE = 256;
const MAX_INFLATED = 64 * 1024 * 1024;
const GZIP_HEADER = 10;
const GZIP_TRAILER = 8;

/** PADMÉ with a 256-byte floor; exact for sizes below 2^31. */
export function paddedSize(n: number): number {
  if (n <= MIN_SIZE) return MIN_SIZE;
  const e = 31 - Math.clz32(n);
  const s = 32 - Math.clz32(e);
  const mask = 2 ** (e - s) - 1;
  return (n + mask) & ~mask;
}

/** Adds the length and the padding around a gzip body. */
export function padBody(body: Uint8Array): Uint8Array {
  const unpadded = 4 + body.length;
  return concat(u32(body.length), body, new Uint8Array(paddedSize(unpadded) - unpadded));
}

export function encodePayload(content: Uint8Array): Uint8Array {
  return padBody(gzipSync(content, { level: 9, mtime: 0 }));
}

export function decodePayload(payload: Uint8Array): Uint8Array {
  if (payload.length < 4) fail("payload");
  const length = readU32(payload, 0);
  if (4 + length > payload.length) fail("payload");
  if (payload.subarray(4 + length).some((byte) => byte !== 0)) fail("payload");
  return inflate(payload.subarray(4, 4 + length));
}

function inflate(body: Uint8Array): Uint8Array {
  // Looked up here so the server, which bundles this module and never decodes, doesn't load it.
  const { crc32, inflateRawSync } = process.getBuiltinModule("node:zlib");
  const trailer = body.length - GZIP_TRAILER;
  if (body[0] !== 0x1f || body[1] !== 0x8b || body[2] !== 8 || body[3] !== 0) fail("payload");
  const deflated = body.subarray(GZIP_HEADER, trailer);
  let inflated: { buffer: Uint8Array; engine: { bytesWritten: number } };
  try {
    inflated = inflateRawSync(deflated, {
      info: true,
      maxOutputLength: MAX_INFLATED,
    }) as unknown as typeof inflated;
  } catch {
    fail("payload");
  }
  const { buffer: content, engine } = inflated;
  const fields = new DataView(body.buffer, body.byteOffset + trailer);
  if (
    engine.bytesWritten !== deflated.length ||
    fields.getUint32(0, true) !== crc32(content) ||
    fields.getUint32(4, true) !== content.length
  ) {
    fail("payload");
  }
  return new Uint8Array(content.buffer, content.byteOffset, content.length);
}
