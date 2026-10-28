import { open, seal } from "./box.ts";
import { concat, equalBytes, u32 } from "./bytes.ts";
import { fail } from "./errors.ts";
import { sha256, tag } from "./kdf.ts";

const blobAad = (group: Uint8Array, epoch: number, did: Uint8Array) =>
  concat(tag("blob"), group, u32(epoch), did);

/** Seals a snapshot blob; its name is the SHA-256 of the result. */
export function sealBlob(
  snapshotKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  did: Uint8Array,
  payload: Uint8Array,
  salt?: Uint8Array,
): Uint8Array {
  return seal(snapshotKey, blobAad(group, epoch, did), payload, salt);
}

export function openBlob(
  snapshotKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  did: Uint8Array,
  blob: Uint8Array,
  expectedHash: Uint8Array,
): Uint8Array {
  if (!equalBytes(sha256(blob), expectedHash)) fail("blob-hash");
  return open(snapshotKey, blobAad(group, epoch, did), blob);
}
