import {
  canonical,
  encodePayload,
  type Header,
  ObjectType,
  parseObject,
  purposeKey,
  purposeOf,
  sealBlob,
  sealObject,
  sha256,
  utf8,
  ZERO_HASH,
} from "../src/index.ts";
import { device, epochKeys, flip, group, hex, rand, type Vectors } from "./fixtures.ts";

const A = device.A;

function object(header: Header, content: string, salt: Uint8Array, epochKeyIndex = header.epoch) {
  const key = purposeKey(
    epochKeys[epochKeyIndex] as Uint8Array,
    group,
    epochKeyIndex,
    purposeOf(header.type),
  );
  return sealObject(header, key, encodePayload(utf8(content)), A.sigSeed, salt);
}

const header = (type: Header["type"], seq: number, prev: Uint8Array, epoch = 0): Header => ({
  type,
  group,
  epoch,
  sender: A.did,
  seq,
  prev,
});

export function envelopeVectors(): Vectors {
  const changes = `${canonical({ collection: "likes", head: "00".repeat(32), link: "default" })}\n{"id":"dQw4w9WgXcQ","kind":"video","state":"like"}`;
  const snapshot = canonical({ head: "00".repeat(32), link: "default", parts: [], vv: {} });
  const ack = canonical({ vv: { [hex(A.did)]: 2 } });
  const live = canonical({ can: ["play", "remote"], type: "presence" });

  const first = object(header(ObjectType.changes, 1, ZERO_HASH), changes, rand("salt 1"));
  const second = object(header(ObjectType.snapshot, 2, sha256(first)), snapshot, rand("salt 2"));
  const third = object(header(ObjectType.ack, 3, sha256(second)), ack, rand("salt 3"));
  const liveMessage = object(header(ObjectType.live, 7, ZERO_HASH), live, rand("salt 4"));
  const cases = [
    { object: first, content: changes, last: undefined },
    { object: second, content: snapshot, last: first },
    { object: third, content: ack, last: second },
    { object: liveMessage, content: live, last: undefined },
  ];

  const resign = (
    bytes: Uint8Array,
    edit: (h: Header) => Header,
    salt: string,
    keyEpoch?: number,
  ) => {
    const parsed = parseObject(bytes, group);
    return object(edit(parsed.header), live, rand(salt), keyEpoch);
  };
  const otherGroup = first.slice();
  otherGroup.set(rand("other group", 16), 6);
  const badSuite = first.slice();
  badSuite[5] = 0x02;
  const fromC = object(
    { ...header(ObjectType.changes, 1, ZERO_HASH), sender: device.C.did },
    changes,
    rand("salt 5"),
  );

  const negatives = [
    { name: "truncated", object: first.subarray(0, 481), error: "length" },
    { name: "bad-magic", object: flip(first, 0), error: "magic" },
    { name: "unknown-suite", object: badSuite, error: "suite" },
    { name: "other-group", object: otherGroup, error: "group" },
    { name: "unknown-sender", object: fromC, error: "sender" },
    { name: "bad-signature", object: flip(first, first.length - 1), error: "signature" },
    { name: "tampered-ciphertext", object: flip(first, 200), error: "signature" },
    { name: "tampered-header", object: flip(first, 45), error: "signature" },
    { name: "replay", object: second, last: second, error: "replay" },
    { name: "gap", object: third, last: first, error: "gap" },
    {
      name: "wrong-prev",
      object: resign(second, (h) => ({ ...h, prev: ZERO_HASH }), "salt 6"),
      last: first,
      error: "prev",
    },
    {
      name: "epoch-swapped",
      object: resign(first, (h) => ({ ...h, epoch: 1 }), "salt 7", 0),
      error: "commitment",
    },
  ];

  const blobPayload = encodePayload(utf8(changes));
  const blob = sealBlob(
    purposeKey(epochKeys[0] as Uint8Array, group, 0, "snapshot"),
    group,
    0,
    A.did,
    blobPayload,
    rand("blob salt"),
  );

  const position = (bytes: Uint8Array | undefined) =>
    bytes && { seq: parseObject(bytes, group).header.seq, hash: hex(sha256(bytes)) };
  return {
    group: hex(group),
    members: { [hex(A.did)]: hex(A.sigPublic) },
    epochKeys: { "0": hex(epochKeys[0] as Uint8Array), "1": hex(epochKeys[1] as Uint8Array) },
    cases: cases.map((c) => ({
      object: hex(c.object),
      content: hex(utf8(c.content)),
      ...(c.last && { last: position(c.last) }),
    })),
    negatives: negatives.map((n) => ({
      name: n.name,
      object: hex(n.object),
      ...(n.last && { last: position(n.last) }),
      error: n.error,
    })),
    blob: {
      sender: hex(A.did),
      epoch: 0,
      blob: hex(blob),
      hash: hex(sha256(blob)),
      content: hex(utf8(changes)),
      negatives: [{ name: "hash-mismatch", blob: hex(flip(blob, 100)), error: "blob-hash" }],
    },
  };
}
