import { describe, expect, test } from "vitest";
import {
  agreementPublicKey,
  chainPath,
  checkEpochKey,
  decodePayload,
  epochCommitment,
  lanFrameAad,
  lanHelloAad,
  lanSessionKeys,
  lanTag,
  lanTranscript,
  memberSecrets,
  open,
  openChain,
  pairingCommit,
  pairingKeys,
  pairingProof,
  pairingSlot,
  purposeKey,
  recoveryKeys,
  recoverySecret,
  recoveryWords,
  toHex,
  unwrapEpochKey,
  utf8,
  wrapEpochKey,
  wrapPath,
} from "../src/index.ts";
import { bytes, expectCode, load } from "./load.ts";

describe("keys", () => {
  const v = load("keys");
  test("member ids", () => {
    for (const m of v.members) {
      const derived = memberSecrets(bytes(m.sigSeed), bytes(m.kemSecret));
      expect([toHex(derived.sigPublic), toHex(derived.kemPublic), toHex(derived.did)]).toEqual([
        m.sigPublic,
        m.kemPublic,
        m.did,
      ]);
    }
  });
  test("epoch commitment and purpose keys", () => {
    const { key, group, epoch, commitment, purposes } = v.epoch;
    expect(toHex(epochCommitment(bytes(key), bytes(group), epoch))).toBe(commitment);
    for (const [purpose, value] of Object.entries(purposes)) {
      expect(toHex(purposeKey(bytes(key), bytes(group), epoch, purpose as "roster"))).toBe(value);
    }
  });
  test("wrap and chain paths", () => {
    const { epoch, commitment, did, wrap, chain } = v.paths;
    expect(wrapPath(epoch, bytes(commitment), did)).toBe(wrap);
    expect(chainPath(epoch, bytes(commitment))).toBe(chain);
  });
  test("wrap and unwrap", async () => {
    const w = v.wrap;
    const args = [bytes(w.group), w.epoch, bytes(w.did)] as const;
    expect(
      toHex(await wrapEpochKey(bytes(w.kemPublic), ...args, bytes(w.key), bytes(w.ikmE))),
    ).toBe(w.wrap);
    const unwrapped = await unwrapEpochKey(bytes(w.kemSecret), ...args, bytes(w.wrap));
    expect(toHex(unwrapped)).toBe(w.key);
    checkEpochKey(unwrapped, bytes(w.group), w.epoch, bytes(v.epoch.commitment));
    await expectCode(
      () => checkEpochKey(unwrapped, bytes(w.group), 2, bytes(v.epoch.commitment)),
      "key-commitment",
    );
    for (const n of w.negatives) {
      await expectCode(
        () =>
          unwrapEpochKey(bytes(w.kemSecret), bytes(w.group), n.epoch, bytes(n.did), bytes(w.wrap)),
        n.error,
      );
    }
  });
  test("history chain", () => {
    const c = v.chain;
    expect(toHex(openChain(bytes(c.key), bytes(c.group), c.epoch, bytes(c.box)))).toBe(
      c.previousKey,
    );
  });
});

describe("recovery", () => {
  const v = load("recovery");
  test("words and keys", () => {
    for (const c of v.cases) {
      expect(recoveryWords(bytes(c.secret))).toBe(c.words);
      expect(toHex(recoverySecret(c.words))).toBe(c.secret);
      expect(toHex(recoveryKeys(bytes(c.secret)).did)).toBe(c.did);
    }
  });
  test("invalid words are rejected", () => {
    for (const words of v.invalidWords) expect(() => recoverySecret(words)).toThrow();
  });
});

test("pairing", () => {
  const v = load("pairing");
  const token = bytes(v.token);
  const shower = pairingKeys(
    bytes(v.showerSecret),
    bytes(v.scannerPublic),
    token,
    bytes(v.showerPublic),
    bytes(v.scannerPublic),
  );
  const scanner = pairingKeys(
    bytes(v.scannerSecret),
    bytes(v.showerPublic),
    token,
    bytes(v.showerPublic),
    bytes(v.scannerPublic),
  );
  expect(scanner).toEqual(shower);
  expect([toHex(shower.showerKey), toHex(shower.scannerKey), shower.sas]).toEqual([
    v.showerKey,
    v.scannerKey,
    v.sas,
  ]);
  expect(toHex(agreementPublicKey(bytes(v.showerSecret)))).toBe(v.showerPublic);
  expect(toHex(pairingSlot(token))).toBe(v.slot);
  expect(toHex(pairingCommit(bytes(v.showerPublic)))).toBe(v.commit);
  expect(toHex(pairingProof(token, bytes(v.scannerPublic)))).toBe(v.proof);
  expect(v.scannerFirst).toBe(v.scannerPublic + v.proof);
  expect(toHex(pairingCommit(bytes(v.refused.showerPublic)))).not.toBe(v.commit);
  expect(v.refused.proof).not.toBe(v.proof);
  const m = v.message;
  const content = decodePayload(open(shower.scannerKey, bytes(m.aad), bytes(m.box)));
  expect(content).toEqual(utf8(m.content));
});

test("lan", () => {
  const v = load("lan");
  const key = bytes(v.lanKey);
  const ids = [
    bytes(v.clientNonce),
    bytes(v.serverNonce),
    bytes(v.clientDid),
    bytes(v.serverDid),
  ] as const;
  expect(toHex(lanTag(key, v.tag.unixSeconds))).toBe(v.tag.tag);
  expect([1, 2, 3].map((n) => toHex(lanHelloAad(n as 1)))).toEqual(v.helloAad);
  expect(toHex(lanTranscript("server", ...ids))).toBe(v.serverTranscript);
  expect(toHex(lanTranscript("client", ...ids))).toBe(v.clientTranscript);
  const session = lanSessionKeys(key, ...ids);
  expect([toHex(session.clientToServer), toHex(session.serverToClient)]).toEqual([
    v.clientToServer,
    v.serverToClient,
  ]);
  expect(toHex(lanFrameAad(5))).toBe(v.frameAad);
});
