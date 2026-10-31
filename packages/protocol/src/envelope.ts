import { BOX_OVERHEAD, open, seal } from "./box.ts";
import { concat, equalBytes, readU32, readU64, u8, u32, u64 } from "./bytes.ts";
import { sign, verify } from "./curve.ts";
import type { Purpose } from "./epoch.ts";
import { fail } from "./errors.ts";
import { sha256, tag } from "./kdf.ts";

export const ObjectType = { changes: 0x01, snapshot: 0x02, ack: 0x03, live: 0x10 } as const;
export type ObjectType = (typeof ObjectType)[keyof typeof ObjectType];

const PURPOSE: Record<ObjectType, Purpose> = {
  [ObjectType.changes]: "changes",
  [ObjectType.snapshot]: "snapshot",
  [ObjectType.ack]: "ack",
  [ObjectType.live]: "live",
};

const MAGIC = Uint8Array.of(0x46, 0x53, 0x32, 0x00);
export const SUITE = 0x01;
export const HEADER_SIZE = 82;
const SIGNATURE_SIZE = 64;
export const MIN_OBJECT_SIZE = HEADER_SIZE + BOX_OVERHEAD + 256 + SIGNATURE_SIZE;
export const MAX_OBJECT_SIZE = 4 * 1024 * 1024;
export const ZERO_HASH = new Uint8Array(32);

export interface Header {
  type: ObjectType;
  group: Uint8Array;
  epoch: number;
  sender: Uint8Array;
  seq: number;
  prev: Uint8Array;
}

export interface ParsedObject {
  header: Header;
  headerBytes: Uint8Array;
  box: Uint8Array;
  signature: Uint8Array;
  hash: Uint8Array;
}

export function purposeOf(type: ObjectType): Purpose {
  return PURPOSE[type];
}

function encodeHeader(h: Header): Uint8Array {
  return concat(MAGIC, u8(h.type), u8(SUITE), h.group, u32(h.epoch), h.sender, u64(h.seq), h.prev);
}

const signedBytes = (headerBytes: Uint8Array, box: Uint8Array) =>
  concat(tag("object"), headerBytes, box);

/** `salt` is only passed explicitly to reproduce test vectors. */
export function sealObject(
  header: Header,
  purposeKey: Uint8Array,
  payload: Uint8Array,
  sigSeed: Uint8Array,
  salt?: Uint8Array,
): Uint8Array {
  const headerBytes = encodeHeader(header);
  const box = seal(purposeKey, headerBytes, payload, salt);
  return concat(headerBytes, box, sign(sigSeed, signedBytes(headerBytes, box)));
}

/** Structural checks only; the caller then verifies the sender and opens the box. */
export function parseObject(bytes: Uint8Array, group: Uint8Array): ParsedObject {
  if (bytes.length < MIN_OBJECT_SIZE || bytes.length > MAX_OBJECT_SIZE) fail("length");
  if (!equalBytes(bytes.subarray(0, 4), MAGIC)) fail("magic");
  const type = bytes[4] as ObjectType;
  if (!(type in PURPOSE) || bytes[5] !== SUITE) fail("suite");
  const header: Header = {
    type,
    group: bytes.slice(6, 22),
    epoch: readU32(bytes, 22),
    sender: bytes.slice(26, 42),
    seq: readU64(bytes, 42),
    prev: bytes.slice(50, 82),
  };
  if (!equalBytes(header.group, group)) fail("group");
  let hash: Uint8Array | undefined;
  return {
    header,
    headerBytes: bytes.subarray(0, HEADER_SIZE),
    box: bytes.subarray(HEADER_SIZE, bytes.length - SIGNATURE_SIZE),
    signature: bytes.subarray(bytes.length - SIGNATURE_SIZE),
    // Hashed on first use: only a reader following a log chain needs it.
    get hash() {
      hash ??= sha256(bytes);
      return hash;
    },
  };
}

export function verifyObject(object: ParsedObject, sigPublic: Uint8Array): void {
  const message = signedBytes(object.headerBytes, object.box);
  if (!verify(sigPublic, message, object.signature)) fail("signature");
}

export function openObject(object: ParsedObject, purposeKey: Uint8Array): Uint8Array {
  return open(purposeKey, object.headerBytes, object.box);
}

export interface StreamPosition {
  seq: number;
  hash: Uint8Array;
}

const STREAM_START: StreamPosition = { seq: 0, hash: ZERO_HASH };

/** Advances a sender's log stream; a sender never read before starts before `seq` 1. */
export function nextInStream(
  last: StreamPosition | undefined,
  object: ParsedObject,
): StreamPosition {
  const { seq, prev } = object.header;
  const from = last ?? STREAM_START;
  if (seq <= from.seq) fail("replay");
  if (seq > from.seq + 1) fail("gap");
  if (!equalBytes(prev, from.hash)) fail("prev");
  return { seq, hash: object.hash };
}

/** Live messages carry a counter instead of a chain. */
export function nextLiveCounter(last: number | undefined, object: ParsedObject): number {
  if (!equalBytes(object.header.prev, ZERO_HASH)) fail("prev");
  if (last !== undefined && object.header.seq <= last) fail("replay");
  return object.header.seq;
}
