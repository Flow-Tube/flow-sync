import { describe, expect, test } from "vitest";
import {
  applyEntry,
  type Entry,
  entryHash,
  forkWinner,
  fromB64,
  openDeviceMeta,
  parseEntry,
  type RosterState,
  replayRoster,
  toHex,
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
    rotate: state.rotate,
    members: [...state.members.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([did, m]) => ({ did, role: m.role, used: m.used })),
    senders: [...state.senders.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([did, s]) => ({
        did,
        role: s.role,
        since: s.since,
        ...(s.until !== undefined && { until: s.until }),
        ...(s.cut && { cut: s.cut }),
      })),
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
  for (const n of v.geneses)
    test(n.name, async () => {
      await expectCode(() => applyEntry(undefined, parseEntry(n.entry)), n.error);
    });
  test("device names open with the roster key of their epoch", () => {
    for (const m of v.meta) {
      const box = fromB64((entries[m.seq] as Entry).meta?.[m.did] ?? "");
      const key = bytes(v.epochKeys[m.epoch]);
      expect(openDeviceMeta(key, bytes(v.group), m.epoch, m.seq, bytes(m.did), box)).toBe(
        m.content,
      );
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
