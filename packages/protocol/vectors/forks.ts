import {
  buildEntry,
  type Entry,
  type EntryDraft,
  entryHash,
  epochDraft,
  groupId,
  leaveDraft,
  type MemberKeys,
  type MemberSecrets,
  memberSecrets,
  memberSubject,
  type RosterSettlement,
  rotateDraft,
  settleRoster,
} from "../src/index.ts";
import { device, group, hex, rand, recovery, type Vectors } from "./fixtures.ts";

const { A, B, C } = device;
const [R1, R2] = recovery as [MemberSecrets, MemberSecrets];
const N = memberSecrets(rand("N sig"), rand("N kem"));
const X = memberSecrets(rand("X sig"), rand("X kem"));
const Y = memberSecrets(rand("Y sig"), rand("Y kem"));
const did = (m: MemberKeys) => hex(m.did);
const key = (label: string) => rand(`fork epoch ${label}`);

function next(previous: Entry | undefined, draft: EntryDraft, signers: MemberSecrets[]): Entry {
  const head = previous && { seq: previous.seq, head: hex(entryHash(previous)) };
  return buildEntry(group, head, draft, signers);
}

function entries() {
  const genesis = next(
    undefined,
    {
      op: "genesis",
      signer: did(A),
      add: [memberSubject(A, "device"), memberSubject(R1, "recovery")],
      epoch: epochDraft(key("genesis"), group, 0, [A, R1]),
    },
    [A, R1],
  );
  const addB = next(genesis, { op: "add", signer: did(A), add: [memberSubject(B, "device")] }, [
    A,
    B,
  ]);
  const addC = next(addB, { op: "add", signer: did(A), add: [memberSubject(C, "device")] }, [A, C]);

  const remove = (
    signer: MemberSecrets,
    target: MemberKeys,
    members: MemberKeys[],
    label: string,
    parent = addC,
    n = 1,
  ) =>
    next(
      parent,
      {
        op: "remove",
        signer: did(signer),
        remove: [did(target)],
        epoch: epochDraft(key(label), group, n, members),
      },
      [signer],
    );
  /** Searches epoch keys until the entry's hash is below `target`, so the case can't pass by luck. */
  const below = (target: Entry, build: (attempt: number) => Entry) => {
    for (let attempt = 0; ; attempt++) {
      const entry = build(attempt);
      if (hex(entryHash(entry)) < hex(entryHash(target))) return entry;
    }
  };
  const rename = (signer: MemberSecrets, parent: Entry, name: string) =>
    next(parent, { op: "rename", signer: did(signer), meta: { [did(signer)]: name } }, [signer]);

  const aRemovesC = remove(A, C, [A, B, R1], "a removes c");
  const cRemovesA = below(aRemovesC, (i) => remove(C, A, [B, C, R1], `c removes a ${i}`));
  const cRemovesB = below(aRemovesC, (i) => remove(C, B, [A, C, R1], `c removes b ${i}`));
  const bRemovesA = remove(B, A, [B, C, R1], "b removes a");
  const onCRemovesA = next(cRemovesA, rotateDraft(C, key("on c"), group, 2, [B, C, R1]), [C]);

  const aRename = rename(A, addC, "a");
  const aRemovesCAbove = remove(A, C, [A, B, R1], "a removes c above", aRename);
  const cRotate = next(addC, rotateDraft(C, key("c rotate"), group, 1, [A, B, C, R1]), [C]);
  const cPad1 = rename(C, cRotate, "c1");
  const cPad2 = rename(C, cPad1, "c2");
  const aRemovesCOnRotate = remove(A, C, [A, B, R1], "a removes c on rotate", cRotate, 2);

  const replaceWords = next(
    addC,
    {
      op: "recovery",
      signer: did(A),
      remove: [did(R1)],
      add: [memberSubject(R2, "recovery")],
      epoch: epochDraft(key("replace words"), group, 1, [A, B, C, R2]),
    },
    [A, R2],
  );
  const restoreEarly = next(
    genesis,
    {
      op: "restore",
      signer: did(R1),
      add: [memberSubject(N, "device")],
      epoch: epochDraft(key("restore early"), group, 1, [A, N, R1]),
    },
    [R1, N],
  );
  const restorePad1 = rename(N, restoreEarly, "n1");
  const restorePad2 = rename(N, restorePad1, "n2");
  const restorePad3 = rename(N, restorePad2, "n3");

  const restore = next(
    addC,
    {
      op: "restore",
      signer: did(R1),
      add: [memberSubject(N, "device")],
      epoch: epochDraft(key("restore"), group, 1, [A, B, C, N, R1]),
    },
    [R1, N],
  );
  const restored = next(
    restore,
    {
      op: "recovery",
      signer: did(N),
      remove: [did(R1)],
      add: [memberSubject(R2, "recovery")],
      epoch: epochDraft(key("restored"), group, 2, [A, B, C, N, R2]),
    },
    [N, R2],
  );

  const aRotate = next(addC, rotateDraft(A, key("a rotate"), group, 1, [A, B, C, R1]), [A]);
  const bRotate = next(addC, rotateDraft(B, key("b rotate"), group, 1, [A, B, C, R1]), [B]);
  const cAdds = next(addC, { op: "add", signer: did(C), add: [memberSubject(N, "device")] }, [
    C,
    N,
  ]);
  const cLeaves = next(addC, leaveDraft(C), [C]);
  const bAdds = next(addC, { op: "add", signer: did(B), add: [memberSubject(N, "device")] }, [
    B,
    N,
  ]);
  const cOnBAdds = rename(C, bAdds, "c3");

  const otherGenesis = next(
    undefined,
    {
      op: "genesis",
      signer: did(A),
      add: [memberSubject(A, "device"), memberSubject(R1, "recovery")],
      epoch: epochDraft(key("other genesis"), group, 0, [A, R1]),
    },
    [A, R1],
  );
  const foreignGenesis = buildEntry(
    groupId(X, Y),
    undefined,
    {
      op: "genesis",
      signer: did(X),
      add: [memberSubject(X, "device"), memberSubject(Y, "recovery")],
      epoch: epochDraft(key("foreign"), groupId(X, Y), 0, [X, Y]),
    },
    [X, Y],
  );

  return {
    genesis,
    addB,
    addC,
    aRemovesC,
    cRemovesA,
    cRemovesB,
    bRemovesA,
    onCRemovesA,
    aRename,
    aRemovesCAbove,
    cRotate,
    cPad1,
    cPad2,
    aRemovesCOnRotate,
    replaceWords,
    restoreEarly,
    restorePad1,
    restorePad2,
    restorePad3,
    restore,
    restored,
    aRotate,
    bRotate,
    cAdds,
    cLeaves,
    bAdds,
    cOnBAdds,
    otherGenesis,
    foreignGenesis,
  };
}

type Name = keyof ReturnType<typeof entries>;

interface Case {
  name: string;
  applied?: Name[];
  /** The store's answer; every name in `applied` is added unless `dropApplied` is set. */
  view: Name[];
  dropApplied?: boolean;
  pins?: Name[];
  linear?: boolean;
}

const BASE: Name[] = ["genesis", "addB", "addC"];

const CASES: Case[] = [
  { name: "no-fork", applied: BASE, view: ["aRemovesC"] },
  { name: "each-removes-the-other", view: [...BASE, "aRemovesC", "cRemovesA"] },
  {
    name: "each-removes-the-other-after-reading-one",
    applied: [...BASE, "aRemovesC"],
    view: ["cRemovesA"],
  },
  {
    name: "pin-one-side",
    applied: [...BASE, "aRemovesC"],
    view: ["cRemovesA"],
    pins: ["aRemovesC"],
  },
  { name: "pin-the-other-side", view: [...BASE, "aRemovesC", "cRemovesA"], pins: ["cRemovesA"] },
  { name: "entry-built-on-one-side", view: [...BASE, "aRemovesC", "cRemovesA", "onCRemovesA"] },
  { name: "removed-signer-with-a-lower-hash", view: [...BASE, "aRemovesC", "cRemovesB"] },
  {
    name: "removed-signer-at-an-earlier-seq",
    view: [...BASE, "aRename", "aRemovesCAbove", "cRotate", "cPad1", "cPad2"],
  },
  {
    name: "replaced-recovery-key-at-an-earlier-seq",
    view: [...BASE, "replaceWords", "restoreEarly", "restorePad1", "restorePad2", "restorePad3"],
  },
  {
    name: "rotate-with-no-removal-above-it",
    view: [...BASE, "aRename", "cRotate", "cPad1", "cPad2"],
  },
  {
    name: "restore-with-no-replacement-above-it",
    view: [...BASE, "restoreEarly", "restorePad1", "restorePad2", "restorePad3"],
  },
  { name: "restore-then-replace", view: [...BASE, "restore", "restored"] },
  { name: "entry-below-its-signers-removal", view: [...BASE, "cRotate", "aRemovesCOnRotate"] },
  { name: "concurrent-rotates", view: [...BASE, "aRotate", "bRotate"] },
  { name: "add-against-removing-its-signer", view: [...BASE, "cAdds", "aRemovesC"] },
  { name: "remover-removed-by-a-third-device", view: [...BASE, "aRemovesC", "bRemovesA"] },
  { name: "leave-against-rotate", view: [...BASE, "cLeaves", "aRotate"] },
  { name: "three-device-cycle", view: [...BASE, "aRemovesC", "cRemovesB", "bRemovesA"] },
  {
    name: "removal-on-a-branch-that-loses-by-rank",
    view: [...BASE, "aRename", "aRemovesCAbove", "bAdds", "cOnBAdds"],
  },
  { name: "applied-entry-missing", applied: [...BASE, "aRemovesC"], view: BASE, dropApplied: true },
  { name: "adopt-the-winner", applied: [...BASE, "cAdds"], view: ["aRemovesC"] },
  {
    name: "linear-store-changes-an-applied-entry",
    applied: [...BASE, "cAdds"],
    view: ["aRemovesC"],
    linear: true,
  },
  { name: "second-genesis-after-one-was-verified", applied: BASE, view: ["otherGenesis"] },
  { name: "second-genesis-on-a-new-device", view: [...BASE, "otherGenesis"] },
  { name: "another-groups-genesis", applied: BASE, view: ["foreignGenesis"] },
];

export function forkVectors(): Vectors {
  const pool = entries();
  const names = new Map(Object.entries(pool).map(([n, e]) => [hex(entryHash(e)), n]));
  const nameOf = (e: Entry) => names.get(hex(entryHash(e))) as string;
  const expected = (settled: RosterSettlement) => {
    if (settled.outcome === "apply") {
      return {
        outcome: settled.outcome,
        chain: settled.chain.map(nameOf),
        standing: settled.standing.map(nameOf).sort(),
        extendsApplied: settled.extendsApplied,
      };
    }
    if (settled.outcome === "contested") {
      return {
        outcome: settled.outcome,
        contested: settled.contested.map(nameOf).sort(),
        sides: settled.sides.map(nameOf).sort(),
      };
    }
    return { outcome: settled.outcome };
  };
  return {
    group: hex(group),
    entries: pool,
    cases: CASES.map((c) => {
      const applied = c.applied ?? [];
      const view = c.dropApplied ? c.view : [...new Set([...applied, ...c.view])];
      const settled = settleRoster({
        group: hex(group),
        applied: applied.map((n) => pool[n]),
        view: view.map((n) => pool[n]),
        pins: new Set((c.pins ?? []).map((n) => hex(entryHash(pool[n])))),
        linear: c.linear ?? false,
      });
      return {
        name: c.name,
        applied,
        view,
        pins: c.pins ?? [],
        linear: c.linear ?? false,
        expect: expected(settled),
      };
    }),
  };
}
