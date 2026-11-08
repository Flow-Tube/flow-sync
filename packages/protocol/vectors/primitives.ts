import {
  canonical,
  concat,
  derive,
  EMPTY,
  encodePayload,
  labeledHash,
  padBody,
  paddedSize,
  readU32,
  seal,
  u32,
  utf8,
} from "../src/index.ts";
import { device, flip, group, hex, rand, type Vectors } from "./fixtures.ts";

export function canonicalVectors(): Vectors {
  const input = { b: [3, { z: true, a: null }], a: 'é\n"', ab: -1, "": 0 };
  // By UTF-16 unit U+1F600 sorts before U+E000, though its code point is higher.
  const beyondBmp = { "\u{1F600}": 1, "\uE000": 2, z: 3 };
  return { cases: [input, beyondBmp].map((i) => ({ input: i, canonical: canonical(i) })) };
}

export function deriveVectors(): Vectors {
  const ikm = rand("ikm");
  const cases = [
    { salt: EMPTY, label: "box", context: EMPTY, length: 76 },
    { salt: group, label: "key changes", context: u32(7), length: 32 },
    { salt: rand("token", 16), label: "sas", context: rand("transcript", 64), length: 4 },
  ].map((c) => ({
    ikm: hex(ikm),
    salt: hex(c.salt),
    label: c.label,
    context: hex(c.context),
    length: c.length,
    okm: hex(derive(ikm, c.salt, c.label, c.context, c.length)),
  }));
  const data = concat(device.A.sigPublic, device.A.kemPublic);
  return {
    cases,
    hashes: [{ label: "device", data: hex(data), hash: hex(labeledHash("device", data)) }],
  };
}

export function boxVectors(): Vectors {
  const key = rand("box key");
  const salt = rand("box salt");
  const aad = utf8("FLOW-SYNC/2 vector aad");
  const plaintext = utf8("box plaintext");
  const box = seal(key, aad, plaintext, salt);
  const negative = (
    name: string,
    b: Uint8Array,
    error: string,
    k: Uint8Array = key,
    a: Uint8Array = aad,
  ) => ({
    name,
    key: hex(k),
    aad: hex(a),
    box: hex(b),
    error,
  });
  return {
    cases: [
      { key: hex(key), aad: hex(aad), plaintext: hex(plaintext), salt: hex(salt), box: hex(box) },
      {
        key: hex(key),
        aad: "",
        plaintext: "",
        salt: hex(rand("box salt 2")),
        box: hex(seal(key, EMPTY, EMPTY, rand("box salt 2"))),
      },
    ],
    negatives: [
      negative("tampered-ciphertext", flip(box, 70), "decrypt"),
      negative("tampered-tag", flip(box, box.length - 1), "decrypt"),
      negative("tampered-commitment", flip(box, 40), "commitment"),
      negative("tampered-salt", flip(box, 0), "commitment"),
      negative("wrong-key", box, "commitment", rand("other key")),
      negative("wrong-aad", box, "decrypt", key, flip(aad, 0)),
      negative("truncated", box.subarray(0, 79), "length"),
    ],
  };
}

export function payloadVectors(): Vectors {
  const records = Array.from(
    { length: 60 },
    (_, i) =>
      `{"progress":0.${i},"videoId":"${hex(rand(`video ${i}`, 6))}","watchedAtMs":${1_793_232_000_000 + i * 7919}}`,
  );
  const contents = ["", "short", records.join("\n")];
  const valid = encodePayload(utf8("short"));
  const tooLong = valid.slice();
  tooLong[3] = 0xff;
  const corrupt = valid.slice();
  corrupt[6] = (corrupt[6] as number) ^ 0xff;
  const memberOf = (payload: Uint8Array) => payload.subarray(4, 4 + readU32(payload, 0));
  const member = memberOf(valid);
  const changed = (index: number, value: number) => {
    const copy = member.slice();
    copy[index] = value;
    return copy;
  };
  const withFlag = (flag: number, fields: Uint8Array) =>
    concat(changed(3, flag).subarray(0, 10), fields, member.subarray(10));
  const deflated = member.subarray(10, -8);
  const trailer = member.subarray(-8);
  const refused = (name: string, body: Uint8Array) => ({
    name,
    payload: hex(padBody(body)),
    error: "payload",
  });
  // Another encoder's header bytes, and a block type fflate wouldn't choose here.
  const otherHeader = concat(
    Uint8Array.of(0x1f, 0x8b, 8, 0, 0xd2, 2, 0x96, 0x49, 2, 11),
    deflated,
    trailer,
  );
  const storedBlock = concat(
    member.subarray(0, 10),
    Uint8Array.of(1, 5, 0, 0xfa, 0xff),
    utf8("short"),
    trailer,
  );
  return {
    sizes: [1, 256, 257, 1000, 4096, 65537, 1_000_000, 4_194_304].map((n) => ({
      length: n,
      padded: paddedSize(n),
    })),
    cases: [
      ...contents.map((content) => ({
        content: hex(utf8(content)),
        payload: hex(encodePayload(utf8(content))),
      })),
      { content: hex(utf8("short")), payload: hex(padBody(otherHeader)) },
      { content: hex(utf8("short")), payload: hex(padBody(storedBlock)) },
    ],
    negatives: [
      { name: "length-past-end", payload: hex(tooLong), error: "payload" },
      { name: "nonzero-padding", payload: hex(flip(valid, valid.length - 1)), error: "payload" },
      { name: "corrupt-gzip", payload: hex(corrupt), error: "payload" },
      { name: "too-short", payload: "000000", error: "payload" },
      refused("two-members", concat(member, memberOf(encodePayload(utf8(" second"))))),
      refused("two-identical-members", concat(member, member)),
      refused("bad-crc", flip(member, member.length - 8)),
      refused("bad-isize", flip(member, member.length - 1)),
      refused("truncated-trailer", member.subarray(0, -4)),
      refused("fhcrc-bad", withFlag(0x02, new Uint8Array(2))),
      refused("empty-body", EMPTY),
      refused("reserved-flag", changed(3, 0x20)),
      refused("trailing-bytes", concat(member, utf8("garbage"))),
      refused("fname", withFlag(0x08, concat(utf8("name"), new Uint8Array(1)))),
      refused("bad-magic", changed(0, 0x1e)),
      refused("bad-method", changed(2, 7)),
      refused("bytes-before-trailer", concat(member.subarray(0, -8), utf8("garbage"), trailer)),
    ],
  };
}
