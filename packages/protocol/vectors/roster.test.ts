import { describe, expect, test } from "vitest";
import {
  applyEntry,
  concat,
  decodePayload,
  type Entry,
  entryHash,
  forkWinner,
  fromB64,
  open,
  parseEntry,
  purposeKey,
  type RosterState,
  replayRoster,
  tag,
  toHex,
  u64,
} from "../src/index.ts";
import { bytes, expectCode, load } from "./load.ts";

const v = load("roster");
const entries: Entry[] = v.entries.map(parseEntry);
const stateAfter = (count: number) => replayRoster(entries.slice(0, count));

function view(state: RosterState) {
  return {
    seq: state.seq,
    head: state.head,
    epoch: state.epoch,
    members: [...state.members.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([did, m]) => ({ did, role: m.role, used: m.used })),
  };
}

describe("roster", () => {
  test("every prefix of the chain gives the expected state", () => {
    entries.forEach((_, i) => {
      expect(view(stateAfter(i + 1))).toEqual(v.states[i]);
    });
  });
  for (const n of v.negatives)
    test(n.name, async () => {
      const base = stateAfter(n.base);
      await expectCode(() => applyEntry(base, parseEntry(n.entry)), n.error);
    });
  test("device names open with the roster key of their epoch", () => {
    const group = bytes(v.group);
    for (const m of v.meta) {
      const entry = entries[m.seq] as Entry;
      const key = purposeKey(bytes(v.epochKeys[m.epoch]), group, m.epoch, "roster");
      const aad = concat(tag("meta"), group, u64(m.seq), bytes(m.did));
      const content = decodePayload(open(key, aad, fromB64(entry.meta?.[m.did] ?? "")));
      expect(new TextDecoder().decode(content)).toBe(m.content);
    }
  });
  test("forks resolve to the same winner", () => {
    for (const f of v.forks) {
      const base = stateAfter(f.base);
      const candidates: Entry[] = f.candidates.map(parseEntry);
      for (const c of candidates) applyEntry(base, c);
      expect(toHex(entryHash(forkWinner(candidates)))).toBe(f.winner);
      expect(toHex(entryHash(forkWinner([...candidates].reverse())))).toBe(f.winner);
    }
  });
});
