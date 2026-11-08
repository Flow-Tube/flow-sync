import {
  buildEntry,
  type Entry,
  type EntryDraft,
  entryHash,
  epochDraft,
  fromB64,
  fromHex,
  leaveDraft,
  type MemberSecrets,
  memberId,
  memberSecrets,
  memberSubject,
  openDeviceMeta,
  type RosterState,
  replayRoster,
  rotateDraft,
  type Subject,
  sealDeviceMeta,
  signEntry,
  signingBytes,
  toB64,
} from "../src/index.ts";
import { mixedOrderKey, signBothEquations, signIdentityR } from "./ed25519.ts";
import { device, epochKeys, group, hex, rand, recovery, type Vectors } from "./fixtures.ts";

const { A, B, C } = device;
const [R1, R2] = recovery as [MemberSecrets, MemberSecrets];
const D = memberSecrets(rand("D sig"), rand("D kem"));
const did = (m: MemberSecrets) => hex(m.did);
const subject = memberSubject;
const epochKey = (n: number) => epochKeys[n] as Uint8Array;
const epoch = (n: number, members: MemberSecrets[]) => epochDraft(epochKey(n), group, n, members);
const rotate = (signer: MemberSecrets, n: number, members: MemberSecrets[]) =>
  rotateDraft(signer, epochKey(n), group, n, members);

function meta(seq: number, m: MemberSecrets, epoch: number, name: string, platform: string) {
  const content = { app: `app-${name.toLowerCase()}`, name, platform };
  return sealDeviceMeta(
    epochKey(epoch),
    group,
    epoch,
    seq,
    m.did,
    content,
    rand(`meta ${seq} ${name}`),
  );
}

type Chain = [Entry, Entry, Entry, Entry, Entry, Entry, Entry, Entry, Entry];

const lowestHash = (entries: Entry[]) => entries.map((e) => hex(entryHash(e))).sort()[0];

function entry(previous: Entry | undefined, draft: EntryDraft, signers: MemberSecrets[]): Entry {
  const head = previous && { seq: previous.seq, head: hex(entryHash(previous)) };
  return buildEntry(group, head, draft, signers);
}

function chain(): Chain {
  const e0 = entry(
    undefined,
    {
      op: "genesis",
      signer: did(A),
      add: [subject(A, "device"), subject(R1, "recovery")],
      epoch: epoch(0, [A, R1]),
      meta: { [did(A)]: meta(0, A, 0, "Pixel", "android") },
    },
    [A, R1],
  );
  const e1 = entry(
    e0,
    {
      op: "add",
      signer: did(A),
      add: [subject(B, "device")],
      meta: { [did(B)]: meta(1, B, 0, "Desktop", "macos") },
    },
    [A, B],
  );
  const e2 = entry(
    e1,
    { op: "rename", signer: did(B), meta: { [did(B)]: meta(2, B, 0, "Studio", "macos") } },
    [B],
  );
  const e3 = entry(
    e2,
    {
      op: "remove",
      signer: did(A),
      remove: [did(B)],
      cut: { [did(B)]: { seq: 2, hash: hex(rand("last object of B")) } },
      epoch: epoch(1, [A, R1]),
    },
    [A],
  );
  const e4 = entry(
    e3,
    {
      op: "restore",
      signer: did(R1),
      add: [subject(C, "device")],
      epoch: epoch(2, [A, C, R1]),
      meta: { [did(C)]: meta(4, C, 2, "Television", "android-tv") },
    },
    [R1, C],
  );
  const e5 = entry(
    e4,
    {
      op: "recovery",
      signer: did(C),
      remove: [did(R1)],
      add: [subject(R2, "recovery")],
      epoch: epoch(3, [A, C, R2]),
    },
    [C, R2],
  );
  const e6 = entry(
    e5,
    {
      op: "add",
      signer: did(C),
      add: [subject(D, "device")],
      meta: { [did(D)]: meta(6, D, 3, "Tablet", "android") },
    },
    [C, D],
  );
  const e7 = entry(e6, leaveDraft(D, { seq: 1, hash: hex(rand("last object of D")) }), [D]);
  const e8 = entry(e7, rotate(A, 4, [A, C, R2]), [A]);
  return [e0, e1, e2, e3, e4, e5, e6, e7, e8];
}

function stateView(state: RosterState) {
  return {
    seq: state.seq,
    head: state.head,
    epoch: state.epoch,
    rotate: state.rotate,
    recoveryDue: state.recoveryDue,
    members: [...state.members.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, m]) => ({
        did: id,
        role: m.role,
        used: m.used,
        ...(m.installer && { installer: m.installer }),
      })),
    senders: [...state.senders.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, s]) => ({
        did: id,
        role: s.role,
        since: s.since,
        ...(s.until !== undefined && { until: s.until }),
        ...(s.cut && { cut: s.cut }),
      })),
  };
}

function negatives(entries: Chain) {
  const [e0, e1, e2, e3, e4, , e6, e7] = entries;
  const weakKey = fromHex("0100000000000000000000000000000000000000000000000000000000000000");
  const weak: Subject = {
    did: hex(memberId(weakKey, C.kemPublic)),
    sig: toB64(weakKey),
    kem: toB64(C.kemPublic),
    role: "device",
  };
  const mixed = mixedOrderKey(rand("mixed sig"));
  const mixedDid = hex(memberId(mixed.key, C.kemPublic));
  const mixedAdd = entry(
    e0,
    {
      op: "add",
      signer: did(A),
      add: [{ did: mixedDid, sig: toB64(mixed.key), kem: toB64(C.kemPublic), role: "device" }],
    },
    [A],
  );
  const identityR = entry(e0, { op: "rename", signer: did(A), meta: { [did(A)]: "AA" } }, []);
  const oneObject = { seq: 1, hash: hex(rand("an object")) };
  const wrongSeq = signEntry(
    { ...entry(e0, { op: "rename", signer: did(A), meta: e0.meta ?? {} }, []), seq: 5 },
    did(A),
    A.sigSeed,
  );
  return [
    {
      name: "bad-signature",
      base: 1,
      entry: { ...e1, sigs: { ...e1.sigs, [did(A)]: e1.sigs[did(B)] } },
      error: "roster-signature",
    },
    {
      name: "missing-reverse-signature",
      base: 1,
      entry: { ...e1, sigs: { [did(A)]: e1.sigs[did(A)] } },
      error: "roster-signature",
    },
    { name: "unknown-field", base: 1, entry: { ...e1, extra: 1 }, error: "roster-format" },
    {
      name: "cut-on-the-wrong-op",
      base: 2,
      entry: entry(
        e1,
        { op: "rotate", signer: did(A), epoch: epoch(1, [A, B, R1]), cut: { [did(B)]: oneObject } },
        [A],
      ),
      error: "roster-op",
    },
    {
      name: "cut-for-a-device-not-removed",
      base: 3,
      entry: entry(
        e2,
        {
          op: "remove",
          signer: did(A),
          remove: [did(B)],
          cut: { [did(A)]: oneObject },
          epoch: epoch(1, [A, R1]),
        },
        [A],
      ),
      error: "roster-op",
    },
    {
      name: "cut-empty",
      base: 3,
      entry: entry(
        e2,
        { op: "remove", signer: did(A), remove: [did(B)], cut: {}, epoch: epoch(1, [A, R1]) },
        [A],
      ),
      error: "roster-format",
    },
    {
      name: "cut-at-seq-zero",
      base: 3,
      entry: entry(
        e2,
        {
          op: "remove",
          signer: did(A),
          remove: [did(B)],
          cut: { [did(B)]: { ...oneObject, seq: 0 } },
          epoch: epoch(1, [A, R1]),
        },
        [A],
      ),
      error: "roster-format",
    },
    { name: "wrong-seq", base: 1, entry: wrongSeq, error: "roster-chain" },
    { name: "truncated-chain", base: 2, entry: e3, error: "roster-chain" },
    {
      name: "removed-signer",
      base: 4,
      entry: entry(e3, { op: "rename", signer: did(B), meta: { [did(A)]: "AA" } }, [B]),
      error: "roster-signer",
    },
    {
      name: "weak-key",
      base: 1,
      entry: entry(e0, { op: "add", signer: did(A), add: [weak] }, [A]),
      error: "roster-key",
    },
    {
      name: "mixed-order-key",
      base: 1,
      entry: {
        ...mixedAdd,
        sigs: {
          ...mixedAdd.sigs,
          [mixedDid]: toB64(signBothEquations(mixed, signingBytes(mixedAdd))),
        },
      },
      error: "roster-key",
    },
    {
      name: "small-order-r",
      base: 1,
      entry: {
        ...identityR,
        sigs: { [did(A)]: toB64(signIdentityR(A.sigSeed, signingBytes(identityR))) },
      },
      error: "roster-signature",
    },
    {
      name: "readd-removed-device",
      base: 4,
      entry: entry(e3, { op: "add", signer: did(A), add: [subject(B, "device")] }, [A, B]),
      error: "roster-key",
    },
    {
      name: "epoch-missing-member",
      base: 3,
      entry: entry(e2, { op: "remove", signer: did(A), remove: [did(B)], epoch: epoch(1, [A]) }, [
        A,
      ]),
      error: "roster-epoch",
    },
    {
      name: "epoch-skipped",
      base: 3,
      entry: entry(
        e2,
        { op: "remove", signer: did(A), remove: [did(B)], epoch: { ...epoch(1, [A, R1]), n: 2 } },
        [A],
      ),
      error: "roster-epoch",
    },
    {
      name: "remove-self",
      base: 3,
      entry: entry(
        e2,
        { op: "remove", signer: did(A), remove: [did(A)], epoch: epoch(1, [B, R1]) },
        [A],
      ),
      error: "roster-op",
    },
    {
      name: "rename-recovery",
      base: 1,
      entry: entry(e0, { op: "rename", signer: did(A), meta: { [did(R1)]: "AA" } }, [A]),
      error: "roster-meta",
    },
    {
      name: "add-by-non-member",
      base: 1,
      entry: entry(e0, { op: "add", signer: did(C), add: [subject(C, "device")] }, [C]),
      error: "roster-signer",
    },
    {
      name: "recovery-used-twice",
      base: 5,
      entry: entry(
        e4,
        {
          op: "restore",
          signer: did(R1),
          add: [subject(D, "device")],
          epoch: epoch(3, [A, C, D, R1]),
        },
        [R1, D],
      ),
      error: "roster-signer",
    },
    {
      name: "leave-by-non-member",
      base: 7,
      entry: entry(e6, leaveDraft(B), [B]),
      error: "roster-signer",
    },
    {
      name: "leave-removing-another",
      base: 7,
      entry: entry(e6, { op: "leave", signer: did(D), remove: [did(C)] }, [D]),
      error: "roster-op",
    },
    {
      name: "leave-with-others",
      base: 7,
      entry: entry(e6, { op: "leave", signer: did(D), remove: [did(C), did(D)] }, [D]),
      error: "roster-op",
    },
    {
      name: "leave-with-epoch",
      base: 7,
      entry: entry(e6, { ...leaveDraft(D), epoch: epoch(4, [A, C, R2]) }, [D]),
      error: "roster-op",
    },
    {
      name: "leave-by-recovery",
      base: 7,
      entry: entry(e6, leaveDraft(R2), [R2]),
      error: "roster-signer",
    },
    {
      name: "leave-last-device",
      base: 4,
      entry: entry(e3, leaveDraft(A), [A]),
      error: "roster-op",
    },
    {
      name: "rotate-without-epoch",
      base: 8,
      entry: entry(e7, { op: "rotate", signer: did(A) }, [A]),
      error: "roster-op",
    },
    {
      name: "rotate-with-remove",
      base: 8,
      entry: entry(e7, { ...rotate(A, 4, [A, R2]), remove: [did(C)] }, [A]),
      error: "roster-op",
    },
    {
      name: "rotate-to-departed",
      base: 8,
      entry: entry(e7, rotate(A, 4, [A, C, D, R2]), [A]),
      error: "roster-epoch",
    },
  ];
}

function forks(entries: Chain) {
  const [, e1, , , , , e6, e7] = entries;
  const candidates = [
    entry(e1, { op: "add", signer: did(A), add: [subject(C, "device")] }, [A, C]),
    entry(e1, { op: "remove", signer: did(A), remove: [did(B)], epoch: epoch(1, [A, R1]) }, [A]),
    entry(
      e1,
      { op: "rename", signer: did(B), meta: { [did(A)]: meta(2, A, 0, "Phone", "android") } },
      [B],
    ),
    entry(
      e1,
      { op: "rename", signer: did(A), meta: { [did(B)]: meta(2, B, 0, "Laptop", "linux") } },
      [A],
    ),
  ];
  const [add, remove, renameA, renameB] = candidates as [Entry, Entry, Entry, Entry];
  const leave = entry(e6, leaveDraft(D), [D]);
  const rotateA = entry(e6, rotate(A, 4, [A, C, D, R2]), [A]);
  const removeD = entry(
    e6,
    { op: "remove", signer: did(C), remove: [did(D)], epoch: epoch(4, [A, C, R2]) },
    [C],
  );
  const rotates = [A, C].map((m) => entry(e7, rotate(m, 4, [A, C, R2]), [m]));
  return [
    { base: 2, candidates: [add, remove, renameA], winner: hex(entryHash(remove)) },
    { base: 2, candidates: [renameA, add], winner: hex(entryHash(add)) },
    { base: 2, candidates: [renameA, renameB], winner: lowestHash([renameA, renameB]) },
    { base: 7, candidates: [rotateA, leave, removeD], winner: hex(entryHash(removeD)) },
    { base: 7, candidates: [rotateA, leave], winner: hex(entryHash(leave)) },
    { base: 8, candidates: rotates, winner: lowestHash(rotates) },
  ];
}

/** Entries on top of the chain, each case applying `steps` in order, the last refused or giving `state`. */
function replacements(entries: Chain) {
  const [, , e2, , , , , , e8] = entries;
  const R3 = memberSecrets(rand("R3 sig"), rand("R3 kem"));
  const E = memberSecrets(rand("E sig"), rand("E kem"));
  const N = memberSecrets(rand("N sig"), rand("N kem"));
  const newKey = (label: string, n: number, members: MemberSecrets[]) =>
    epochDraft(rand(`replacement ${label}`), group, n, members);
  const removeC = (replace: boolean, cut = false) =>
    entry(
      e8,
      {
        op: "remove",
        signer: did(A),
        remove: replace ? [did(C), did(R2)] : [did(C)],
        ...(replace && { add: [subject(R3, "recovery")] }),
        ...(cut && { cut: { [did(R2)]: { seq: 1, hash: hex(rand("an object")) } } }),
        epoch: newKey("remove C", 5, replace ? [A, R3] : [A, R2]),
      },
      replace ? [A, R3] : [A],
    );
  const addE = entry(e8, { op: "add", signer: did(A), add: [subject(E, "device")] }, [A, E]);
  const cLeaves = entry(addE, leaveDraft(C), [C]);
  const removeE = (replace: boolean) =>
    entry(
      cLeaves,
      {
        op: "remove",
        signer: did(A),
        remove: replace ? [did(E), did(R2)] : [did(E)],
        ...(replace && { add: [subject(R3, "recovery")] }),
        epoch: newKey("remove E", 5, replace ? [A, R3] : [A, R2]),
      },
      replace ? [A, R3] : [A],
    );
  const replaced = entry(
    cLeaves,
    {
      op: "recovery",
      signer: did(A),
      remove: [did(R2)],
      add: [subject(R3, "recovery")],
      epoch: newKey("after leave", 5, [A, E, R3]),
    },
    [A, R3],
  );
  const rotated = entry(cLeaves, rotate(A, 4, [A, E, R2]), [A]);
  const notDue = entry(
    e2,
    {
      op: "remove",
      signer: did(A),
      remove: [did(B), did(R1)],
      add: [subject(R2, "recovery")],
      epoch: epoch(1, [A, R2]),
    },
    [A, R2],
  );
  const restoreN = entry(
    e8,
    {
      op: "restore",
      signer: did(R2),
      add: [subject(N, "device")],
      epoch: newKey("restore N", 5, [A, C, N, R2]),
    },
    [R2, N],
  );
  const replaceAfterRestore = entry(
    restoreN,
    {
      op: "recovery",
      signer: did(N),
      remove: [did(R2)],
      add: [subject(R3, "recovery")],
      epoch: newKey("replace after restore", 6, [A, C, N, R3]),
    },
    [N, R3],
  );
  const removeOthers = entry(
    replaceAfterRestore,
    {
      op: "remove",
      signer: did(N),
      remove: [did(A), did(C)].sort(),
      cut: { [did(A)]: { seq: 1, hash: hex(rand("last object of A")) } },
      epoch: newKey("remove others", 7, [N, R3]),
    },
    [N],
  );
  const view = (...steps: Entry[]) => stateView(replayRoster([...entries, ...steps]));
  return [
    {
      name: "removing-the-device-that-set-the-key-replaces-it",
      steps: [removeC(true)],
      state: view(removeC(true)),
    },
    {
      name: "removing-the-device-that-set-the-key-without-replacing",
      steps: [removeC(false)],
      error: "roster-op",
    },
    { name: "cut-for-the-replaced-key", steps: [removeC(true, true)], error: "roster-op" },
    {
      name: "the-device-that-set-the-key-left",
      steps: [addE, cLeaves],
      state: view(addE, cLeaves),
    },
    { name: "rotate-while-the-key-is-due", steps: [addE, cLeaves, rotated], error: "roster-op" },
    {
      name: "removal-while-the-key-is-due-without-replacing",
      steps: [addE, cLeaves, removeE(false)],
      error: "roster-op",
    },
    {
      name: "removal-while-the-key-is-due",
      steps: [addE, cLeaves, removeE(true)],
      state: view(addE, cLeaves, removeE(true)),
    },
    {
      name: "new-words-after-the-device-left",
      steps: [addE, cLeaves, replaced],
      state: view(addE, cLeaves, replaced),
    },
    { name: "replacement-not-called-for", base: 3, steps: [notDue], error: "roster-op" },
    {
      name: "restore-then-remove-the-other-devices",
      steps: [restoreN, replaceAfterRestore, removeOthers],
      state: view(restoreN, replaceAfterRestore, removeOthers),
    },
  ];
}

/** A genesis whose group id isn't the one its keys commit to. */
function geneses() {
  const device = memberSecrets(rand("rival device sig"), rand("rival device kem"));
  const rival = memberSecrets(rand("rival recovery sig"), rand("rival recovery kem"));
  return [
    {
      name: "group-id-from-other-keys",
      entry: entry(
        undefined,
        {
          op: "genesis",
          signer: did(device),
          add: [subject(device, "device"), subject(rival, "recovery")],
          epoch: epochDraft(rand("rival epoch"), group, 0, [device, rival]),
        },
        [device, rival],
      ),
      error: "roster-group",
    },
  ];
}

function metaContents(entries: Entry[]) {
  return entries.flatMap((e) => {
    const epoch = replayRoster(entries.slice(0, e.seq + 1)).epoch;
    return Object.entries(e.meta ?? {}).map(([id, box]) => ({
      seq: e.seq,
      did: id,
      epoch,
      content: openDeviceMeta(epochKey(epoch), group, epoch, e.seq, fromHex(id), fromB64(box)),
    }));
  });
}

export function rosterVectors(): Vectors {
  const entries = chain();
  return {
    group: hex(group),
    epochKeys: epochKeys.map(hex),
    entries,
    meta: metaContents(entries),
    states: entries.map((_, i) => stateView(replayRoster(entries.slice(0, i + 1)))),
    negatives: negatives(entries),
    forks: forks(entries),
    replacements: replacements(entries),
    geneses: geneses(),
  };
}
