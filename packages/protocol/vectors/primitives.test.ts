import { describe, expect, test } from "vitest";
import {
  canonical,
  decodePayload,
  derive,
  isValidSigningKey,
  labeledHash,
  open,
  paddedSize,
  seal,
  toHex,
  verify,
} from "../src/index.ts";
import { bytes, expectCode, load } from "./load.ts";

test("canonical JSON", () => {
  for (const c of load("canonical").cases) expect(canonical(c.input)).toBe(c.canonical);
});

test("labelled derivation and hash", () => {
  const v = load("derive");
  for (const c of v.cases) {
    const okm = derive(bytes(c.ikm), bytes(c.salt), c.label, bytes(c.context), c.length);
    expect(toHex(okm)).toBe(c.okm);
  }
  for (const h of v.hashes) expect(toHex(labeledHash(h.label, bytes(h.data)))).toBe(h.hash);
});

describe("ed25519", () => {
  const v = load("ed25519");
  for (const c of v.cases)
    test(c.name, () => {
      expect(verify(bytes(c.publicKey), bytes(c.message), bytes(c.signature))).toBe(c.valid);
    });
  test("weak, non-canonical and mixed-order keys are rejected", () => {
    for (const key of [...v.weakKeys, ...v.nonCanonicalKeys, ...v.mixedOrderKeys]) {
      expect(isValidSigningKey(bytes(key))).toBe(false);
    }
  });
});

describe("box", () => {
  const v = load("box");
  test("seal and open", () => {
    for (const c of v.cases) {
      expect(toHex(seal(bytes(c.key), bytes(c.aad), bytes(c.plaintext), bytes(c.salt)))).toBe(
        c.box,
      );
      expect(toHex(open(bytes(c.key), bytes(c.aad), bytes(c.box)))).toBe(c.plaintext);
    }
  });
  for (const n of v.negatives)
    test(n.name, async () => {
      await expectCode(() => open(bytes(n.key), bytes(n.aad), bytes(n.box)), n.error);
    });
});

describe("payload", () => {
  const v = load("payload");
  test("padding sizes", () => {
    for (const s of v.sizes) expect(paddedSize(s.length)).toBe(s.padded);
  });
  test("decode", () => {
    for (const c of v.cases) expect(toHex(decodePayload(bytes(c.payload)))).toBe(c.content);
  });
  for (const n of v.negatives)
    test(n.name, async () => {
      await expectCode(() => decodePayload(bytes(n.payload)), n.error);
    });
});
