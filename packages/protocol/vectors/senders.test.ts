import { describe, expect, test } from "vitest";
import {
  checkSender,
  cutChain,
  type Entry,
  parseEntry,
  replayRoster,
  toHex,
} from "../src/index.ts";
import { bytes, expectCode, load } from "./load.ts";

const v = load("senders");
const state = replayRoster(v.entries.map(parseEntry) as Entry[]);

describe("senders", () => {
  for (const c of v.senders)
    test(c.name, async () => {
      const check = () => checkSender(state, c.did, c.epoch, c.seq);
      if (c.error) await expectCode(check, c.error);
      else expect(check().sig.length).toBe(32);
    });
});

describe("the walk down from a cut", () => {
  for (const w of v.walks)
    test(w.name, async () => {
      const last = w.last && { seq: w.last.seq, hash: bytes(w.last.hash) };
      const walk = () =>
        cutChain({ seq: w.cut.seq, hash: bytes(w.cut.hash) }, last, bytes(v.group), (seq) => {
          const object = w.log[seq - 1];
          return object ? bytes(object) : undefined;
        });
      if (w.error) await expectCode(walk, w.error);
      else expect([...walk().values()].reverse().map(toHex)).toEqual(w.hashes);
    });
});
