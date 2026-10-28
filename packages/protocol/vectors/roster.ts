import {
  canonical,
  concat,
  decodePayload,
  type Entry,
  encodePayload,
  entryHash,
  epochCommitment,
  fromB64,
  fromHex,
  type MemberSecrets,
  memberId,
  memberSecrets,
  open,
  purposeKey,
  type RosterState,
  replayRoster,
  type Subject,
  seal,
  signEntry,
  tag,
  toB64,
  u64,
  utf8,
  ZERO_HASH,
} from "../src/index.ts";
import { device, epochKeys, group, hex, rand, recovery, type Vectors } from "./fixtures.ts";

const { A, B, C } = device;
const [R1, R2] = recovery as [MemberSecrets, MemberSecrets];
const D = memberSecrets(rand("D sig"), rand("D kem"));
const did = (m: MemberSecrets) => hex(m.did);

const subject = (m: MemberSecrets, role: Subject["role"]): Subject => ({
  did: did(m),
  sig: toB64(m.sigPublic),
  kem: toB64(m.kemPublic),
  role,
});

const metaAad = (seq: number, did: Uint8Array) => concat(tag("meta"), group, u64(seq), did);
const metaKey = (epoch: number) =>
  purposeKey(epochKeys[epoch] as Uint8Array, group, epoch, "roster");

function meta(seq: number, m: MemberSecrets, epoch: number, name: string, platform: string) {
  const content = canonical({ app: `app-${name.toLowerCase()}`, name, platform });
  const box = seal(
    metaKey(epoch),
    metaAad(seq, m.did),
    encodePayload(utf8(content)),
    rand(`meta ${seq} ${name}`),
  );
  return toB64(box);
}

const epoch = (n: number, members: MemberSecrets[]) => ({
  n,
  kc: toB64(epochCommitment(epochKeys[n] as Uint8Array, group, n)),
  to: members.map(did).sort(),
});

type Draft = Omit<Entry, "v" | "group" | "seq" | "prev" | "sigs">;

function entry(previous: Entry | undefined, draft: Draft, signers: MemberSecrets[]): Entry {
  const unsigned: Entry = {
    v: 2,
    group: hex(group),
    seq: previous ? previous.seq + 1 : 0,
    prev: hex(previous ? entryHash(previous) : ZERO_HASH),
    ...draft,
    ...(draft.add && { add: [...draft.add].sort((a, b) => (a.did < b.did ? -1 : 1)) }),
    ...(draft.remove && { remove: [...draft.remove].sort() }),
    sigs: {},
  };
  return signers.reduce((e, m) => signEntry(e, did(m), m.sigSeed), unsigned);
}

function chain(): Entry[] {
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
    { op: "remove", signer: did(A), remove: [did(B)], epoch: epoch(1, [A, R1]) },
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
  return [e0, e1, e2, e3, e4, e5];
}

function stateView(state: RosterState) {
  return {
    seq: state.seq,
    head: state.head,
    epoch: state.epoch,
    members: [...state.members.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, m]) => ({ did: id, role: m.role, used: m.used })),
  };
}

function negatives(entries: Entry[]) {
  const [e0, e1, e2, e3, e4] = entries as [Entry, Entry, Entry, Entry, Entry];
  const weakKey = fromHex("0100000000000000000000000000000000000000000000000000000000000000");
  const weak: Subject = {
    did: hex(memberId(weakKey, C.kemPublic)),
    sig: toB64(weakKey),
    kem: toB64(C.kemPublic),
    role: "device",
  };
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
  ];
}

function forks(entries: Entry[]) {
  const [, e1] = entries as [Entry, Entry];
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
  const lowest = [renameA, renameB].sort((a, b) =>
    hex(entryHash(a)) < hex(entryHash(b)) ? -1 : 1,
  )[0] as Entry;
  return [
    { base: 2, candidates: [add, remove, renameA], winner: hex(entryHash(remove)) },
    { base: 2, candidates: [renameA, add], winner: hex(entryHash(add)) },
    { base: 2, candidates: [renameA, renameB], winner: hex(entryHash(lowest)) },
  ];
}

function metaContents(entries: Entry[]) {
  return entries.flatMap((e) => {
    const epoch = replayRoster(entries.slice(0, e.seq + 1)).epoch;
    return Object.entries(e.meta ?? {}).map(([id, box]) => ({
      seq: e.seq,
      did: id,
      epoch,
      content: new TextDecoder().decode(
        decodePayload(open(metaKey(epoch), metaAad(e.seq, fromHex(id)), fromB64(box))),
      ),
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
  };
}
