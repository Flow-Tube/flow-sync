import { describe, expect, test } from "vitest";
import {
  type Entry,
  entryHash,
  parseEntry,
  type RosterSettlement,
  settleRoster,
  toHex,
} from "../src/index.ts";
import { load } from "./load.ts";

const v = load("forks");
const pool = new Map<string, Entry>(
  Object.entries(v.entries).map(([name, entry]) => [name, parseEntry(entry)]),
);
const entry = (name: string) => pool.get(name) as Entry;
const hashes = new Map([...pool].map(([name, e]) => [toHex(entryHash(e)), name]));
const names = (entries: Entry[]) =>
  entries.map((e) => hashes.get(toHex(entryHash(e))) as string).sort();

function view(settled: RosterSettlement) {
  if (settled.outcome === "apply") {
    return {
      outcome: settled.outcome,
      chain: settled.chain.map((e) => hashes.get(toHex(entryHash(e)))),
      standing: names(settled.standing),
      extendsApplied: settled.extendsApplied,
    };
  }
  if (settled.outcome === "contested") {
    return {
      outcome: settled.outcome,
      contested: names(settled.contested),
      sides: names(settled.sides),
    };
  }
  return { outcome: settled.outcome };
}

describe("roster forks", () => {
  for (const c of v.cases) {
    const settle = (order: string[]) =>
      settleRoster({
        group: v.group,
        applied: c.applied.map(entry),
        view: order.map(entry),
        pins: new Set(c.pins.map((n: string) => toHex(entryHash(entry(n))))),
        linear: c.linear,
      });
    test(c.name, () => {
      expect(view(settle(c.view))).toEqual(c.expect);
      expect(view(settle([...c.view].reverse()))).toEqual(c.expect);
    });
  }
});
