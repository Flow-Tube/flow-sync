import {
  encodePayload,
  type Header,
  logPath,
  type MemberSecrets,
  ObjectType,
  purposeKey,
  purposeOf,
  sealObject,
  toHex,
  utf8,
  ZERO_HASH,
} from "@flow-sync/protocol";

export interface ObjectOptions {
  group: Uint8Array;
  epochKey: Uint8Array;
  epoch?: number;
  type?: Header["type"];
  prev?: Uint8Array;
  content?: string;
}

/** A log object sealed and signed the way a device writes it. */
export function sealedObject(
  sender: MemberSecrets,
  seq: number,
  options: ObjectOptions,
): Uint8Array {
  const { group, epochKey, epoch = 0, type = ObjectType.changes, prev = ZERO_HASH } = options;
  const key = purposeKey(epochKey, group, epoch, purposeOf(type));
  const header = { type, group, epoch, sender: sender.did, seq, prev };
  return sealObject(header, key, encodePayload(utf8(options.content ?? "{}")), sender.sigSeed);
}

export const objectUrl = (sender: MemberSecrets, seq: number) =>
  `/v1/objects/${logPath(toHex(sender.did), seq)}`;

export function putBytes(
  token: string,
  bytes: Uint8Array,
  type = "application/octet-stream",
): RequestInit {
  return {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": type },
    body: bytes,
  };
}
