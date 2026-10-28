import { describe, expect, test } from "vitest";
import {
  decodePayload,
  fail,
  nextInStream,
  nextLiveCounter,
  ObjectType,
  openBlob,
  openObject,
  parseObject,
  purposeKey,
  purposeOf,
  toHex,
  verifyObject,
} from "../src/index.ts";
import { bytes, expectCode, load } from "./load.ts";

const v = load("envelope");
const group = bytes(v.group);

/** The reading order from store.md, as an app implements it. */
function read(hexObject: string, last?: { seq: number; hash: string }): string {
  const object = parseObject(bytes(hexObject), group);
  const sigPublic = v.members[toHex(object.header.sender)];
  if (!sigPublic) fail("sender");
  verifyObject(object, bytes(sigPublic));
  if (object.header.type === ObjectType.live) nextLiveCounter(undefined, object);
  else nextInStream(last && { seq: last.seq, hash: bytes(last.hash) }, object);
  const epochKey = bytes(v.epochKeys[String(object.header.epoch)]);
  const key = purposeKey(epochKey, group, object.header.epoch, purposeOf(object.header.type));
  return toHex(decodePayload(openObject(object, key)));
}

describe("envelope", () => {
  test("valid objects open in stream order", () => {
    for (const c of v.cases) expect(read(c.object, c.last)).toBe(c.content);
  });
  for (const n of v.negatives)
    test(n.name, async () => {
      await expectCode(() => read(n.object, n.last), n.error);
    });
});

describe("snapshot blob", () => {
  const b = v.blob;
  const key = purposeKey(bytes(v.epochKeys["0"]), group, b.epoch, "snapshot");
  const openWith = (blob: string) =>
    openBlob(key, group, b.epoch, bytes(b.sender), bytes(blob), bytes(b.hash));
  test("opens", () => {
    expect(toHex(decodePayload(openWith(b.blob)))).toBe(b.content);
  });
  for (const n of b.negatives)
    test(n.name, async () => {
      await expectCode(() => openWith(n.blob), n.error);
    });
});
