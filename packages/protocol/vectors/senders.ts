import {
  buildEntry,
  type Entry,
  type EntryDraft,
  encodePayload,
  entryHash,
  epochDraft,
  leaveDraft,
  type MemberSecrets,
  memberSecrets,
  memberSubject,
  ObjectType,
  purposeKey,
  rotateDraft,
  sealObject,
  sha256,
  utf8,
  ZERO_HASH,
} from "../src/index.ts";
import { device, epochKeys, group, hex, rand, recovery, type Vectors } from "./fixtures.ts";

const { A, B, C } = device;
const [R1, R2] = recovery as [MemberSecrets, MemberSecrets];
const E = memberSecrets(rand("E sig"), rand("E kem"));
const did = (m: MemberSecrets) => hex(m.did);
const key = (n: number) => epochKeys[n] as Uint8Array;
const epoch = (n: number, members: MemberSecrets[]) => epochDraft(key(n), group, n, members);

function next(previous: Entry | undefined, draft: EntryDraft, signers: MemberSecrets[]): Entry {
  const head = previous && { seq: previous.seq, head: hex(entryHash(previous)) };
  return buildEntry(group, head, draft, signers);
}

/** Objects B wrote under epoch 0, chained from `prev`. */
function object(seq: number, prev: Uint8Array, salt: string): Uint8Array {
  const header = {
    type: ObjectType.changes,
    group,
    epoch: 0,
    sender: B.did,
    seq,
    prev,
  };
  const content = encodePayload(utf8(`object ${salt}`));
  return sealObject(
    header,
    purposeKey(key(0), group, 0, "changes"),
    content,
    B.sigSeed,
    rand(salt),
  );
}

function chain(cut: { seq: number; hash: string }): Entry[] {
  const e0 = next(
    undefined,
    {
      op: "genesis",
      signer: did(A),
      add: [memberSubject(A, "device"), memberSubject(R1, "recovery")],
      epoch: epoch(0, [A, R1]),
    },
    [A, R1],
  );
  const e1 = next(e0, { op: "add", signer: did(A), add: [memberSubject(B, "device")] }, [A, B]);
  const e2 = next(e1, rotateDraft(A, key(1), group, 1, [A, B, R1]), [A]);
  const e3 = next(e2, { op: "add", signer: did(A), add: [memberSubject(C, "device")] }, [A, C]);
  const e4 = next(e3, { op: "add", signer: did(A), add: [memberSubject(E, "device")] }, [A, E]);
  const e5 = next(
    e4,
    {
      op: "remove",
      signer: did(A),
      remove: [did(B), did(E)],
      cut: { [did(B)]: cut },
      epoch: epoch(2, [A, C, R1]),
    },
    [A],
  );
  const e6 = next(
    e5,
    {
      op: "recovery",
      signer: did(A),
      remove: [did(R1)],
      add: [memberSubject(R2, "recovery")],
      epoch: epoch(3, [A, C, R2]),
    },
    [A, R2],
  );
  const e7 = next(e6, leaveDraft(C, { seq: 1, hash: hex(rand("last object of C")) }), [C]);
  const e8 = next(e7, rotateDraft(A, key(4), group, 4, [A, R2]), [A]);
  return [e0, e1, e2, e3, e4, e5, e6, e7, e8];
}

export function senderVectors(): Vectors {
  const first = object(1, ZERO_HASH, "first");
  const second = object(2, sha256(first), "second");
  const third = object(3, sha256(second), "third");
  const forged = object(2, sha256(first), "forged");
  const cut = { seq: 3, hash: hex(sha256(third)) };
  const position = (seq: number, bytes: Uint8Array) => ({ seq, hash: hex(sha256(bytes)) });
  const hashes = (...objects: Uint8Array[]) => objects.map((o) => hex(sha256(o)));

  return {
    group: hex(group),
    entries: chain(cut),
    senders: [
      { name: "current-device", did: did(A), epoch: 4, seq: 9 },
      { name: "current-device-under-an-old-epoch", did: did(A), epoch: 0, seq: 9 },
      { name: "removed-at-its-cut", did: did(B), epoch: 1, seq: 3 },
      { name: "removed-below-its-cut", did: did(B), epoch: 0, seq: 1 },
      { name: "removed-above-its-cut", did: did(B), epoch: 1, seq: 4, error: "sender" },
      { name: "removed-after-its-last-epoch", did: did(B), epoch: 2, seq: 1, error: "sender" },
      { name: "joined-later", did: did(C), epoch: 0, seq: 1, error: "sender" },
      { name: "from-the-epoch-it-joined", did: did(C), epoch: 1, seq: 1 },
      { name: "left-at-its-cut", did: did(C), epoch: 3, seq: 1 },
      { name: "left-above-its-cut", did: did(C), epoch: 3, seq: 2, error: "sender" },
      { name: "after-it-left", did: did(C), epoch: 4, seq: 1, error: "sender" },
      { name: "removed-with-no-cut", did: did(E), epoch: 1, seq: 1, error: "sender" },
      { name: "replaced-recovery-key", did: did(R1), epoch: 0, seq: 1, error: "sender" },
      { name: "current-recovery-key", did: did(R2), epoch: 3, seq: 1, error: "sender" },
      { name: "stranger", did: hex(rand("stranger", 16)), epoch: 0, seq: 1, error: "sender" },
    ],
    walks: [
      {
        name: "from-the-start",
        cut,
        log: [first, second, third].map(hex),
        hashes: hashes(first, second, third),
      },
      {
        name: "from-the-reader-s-position",
        cut,
        last: position(1, first),
        log: ["", hex(second), hex(third)],
        hashes: hashes(second, third),
      },
      {
        name: "reader-already-past-it",
        cut: { seq: 2, hash: hex(sha256(second)) },
        last: position(3, third),
        log: [],
        hashes: [],
      },
      {
        name: "object-below-the-cut-replaced",
        cut,
        log: [first, forged, third].map(hex),
        error: "prev",
      },
      {
        name: "object-at-the-cut-replaced",
        cut,
        log: [first, second, forged].map(hex),
        error: "prev",
      },
      {
        name: "does-not-reach-the-reader-s-position",
        cut,
        last: position(1, forged),
        log: ["", hex(second), hex(third)],
        error: "prev",
      },
      { name: "object-missing", cut, log: [hex(first), "", hex(third)], error: "gap" },
    ],
  };
}
