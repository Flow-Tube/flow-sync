import { z } from "zod";
import { concat, fromB64, toB64, toHex, utf8 } from "./bytes.ts";
import { canonical, type Json } from "./canonical.ts";
import { isValidSigningKey, type SignatureCheck, sign, verify } from "./curve.ts";
import { ZERO_HASH } from "./envelope.ts";
import { fail } from "./errors.ts";
import { sha256, tag } from "./kdf.ts";
import { memberId } from "./keys.ts";

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));
const b64 = (bytes: number) => z.string().refine((s) => decodesTo(s, bytes));
const did = hex(16);

function decodesTo(value: string, length: number): boolean {
  try {
    return fromB64(value).length === length;
  } catch {
    return false;
  }
}

const subjectSchema = z.strictObject({
  did,
  sig: b64(32),
  kem: b64(32),
  role: z.enum(["device", "recovery"]),
});

const entrySchema = z.strictObject({
  v: z.literal(2),
  group: hex(16),
  seq: z.int().min(0),
  prev: hex(32),
  op: z.enum(["genesis", "add", "remove", "leave", "rotate", "rename", "restore", "recovery"]),
  signer: did,
  add: z.array(subjectSchema).min(1).optional(),
  remove: z.array(did).min(1).optional(),
  epoch: z.strictObject({ n: z.int().min(0), kc: b64(32), to: z.array(did).min(1) }).optional(),
  meta: z.record(did, z.string().min(1)).optional(),
  sigs: z.record(did, b64(64)),
});

export type Subject = z.infer<typeof subjectSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Op = Entry["op"];
export type UnsignedEntry = Omit<Entry, "sigs">;

export interface Member {
  sig: Uint8Array;
  kem: Uint8Array;
  role: Subject["role"];
  used: boolean;
}

export interface RosterState {
  group: string;
  seq: number;
  head: string;
  epoch: number;
  kc: string;
  /** A device left during this epoch, so the next device to write must append a rotate first. */
  rotate: boolean;
  members: ReadonlyMap<string, Member>;
  seen: ReadonlySet<string>;
}

export function parseEntry(value: unknown): Entry {
  const result = entrySchema.safeParse(value);
  if (!result.success) fail("roster-format");
  return result.data;
}

export function signingBytes(entry: UnsignedEntry | Entry): Uint8Array {
  const { sigs: _, ...unsigned } = entry as Entry;
  return concat(tag("roster"), utf8(canonical(unsigned as Json)));
}

export function entryHash(entry: Entry): Uint8Array {
  return sha256(utf8(canonical(entry as Json)));
}

export function signEntry(entry: Entry, signerDid: string, sigSeed: Uint8Array): Entry {
  const signature = toB64(sign(sigSeed, signingBytes(entry)));
  return { ...entry, sigs: { ...entry.sigs, [signerDid]: signature } };
}

const isSorted = (values: string[]) =>
  values.every((v, i) => i === 0 || (values[i - 1] as string) < v);
const sameSet = (a: string[], b: Iterable<string>) => {
  const sorted = [...b].sort();
  return a.length === sorted.length && a.every((v, i) => v === sorted[i]);
};

/** The op table from protocol.md: which fields each op requires and forbids. */
const OPS: Record<Op, { add: number | "none"; remove: boolean; epoch: boolean }> = {
  genesis: { add: 2, remove: false, epoch: true },
  add: { add: 1, remove: false, epoch: false },
  remove: { add: "none", remove: true, epoch: true },
  leave: { add: "none", remove: true, epoch: false },
  rotate: { add: "none", remove: false, epoch: true },
  rename: { add: "none", remove: false, epoch: false },
  restore: { add: 1, remove: false, epoch: true },
  recovery: { add: 1, remove: true, epoch: true },
};

function checkShape(entry: Entry): void {
  const rule = OPS[entry.op];
  const added = entry.add?.length ?? 0;
  if (rule.add === "none" ? added !== 0 : added !== rule.add) fail("roster-op");
  if (rule.remove !== (entry.remove !== undefined)) fail("roster-op");
  if (rule.epoch !== (entry.epoch !== undefined)) fail("roster-op");
  if (entry.add && !isSorted(entry.add.map((s) => s.did))) fail("roster-format");
  if (entry.remove && !isSorted(entry.remove)) fail("roster-format");
  if (entry.epoch && !isSorted(entry.epoch.to)) fail("roster-format");
  const roles = (entry.add ?? []).map((s) => s.role).sort();
  const expected =
    entry.op === "genesis"
      ? ["device", "recovery"]
      : entry.op === "recovery"
        ? ["recovery"]
        : ["device"];
  if (added > 0 && roles.join() !== expected.join()) fail("roster-op");
}

function checkSubject(subject: Subject, seen: ReadonlySet<string>): Member {
  const sig = fromB64(subject.sig);
  const kem = fromB64(subject.kem);
  if (!isValidSigningKey(sig)) fail("roster-key");
  if (toHex(memberId(sig, kem)) !== subject.did || seen.has(subject.did)) fail("roster-key");
  return { sig, kem, role: subject.role, used: false };
}

function checkSigner(entry: Entry, state: RosterState | undefined, added: Map<string, Member>) {
  if (entry.op === "genesis") {
    const signer = added.get(entry.signer);
    if (signer?.role !== "device") fail("roster-signer");
    return signer;
  }
  const signer = state?.members.get(entry.signer);
  if (!signer) fail("roster-signer");
  const wanted = entry.op === "restore" ? "recovery" : "device";
  if (signer.role !== wanted || signer.used) fail("roster-signer");
  return signer;
}

/** Applies one entry to the state before it; throws a FlowSyncError if it is not valid. */
export function applyEntry(state: RosterState | undefined, entry: Entry): RosterState {
  const checked = checkEntry(state, entry);
  for (const { key, message, signature } of checked.signatures) {
    if (!verify(key, message, signature)) fail("roster-signature");
  }
  return checked.state;
}

/**
 * Applies every rule except the signature checks, which it returns for the caller to run.
 * The resulting state is valid only once all of them pass.
 */
export function checkEntry(
  state: RosterState | undefined,
  entry: Entry,
): { state: RosterState; signatures: SignatureCheck[] } {
  if (state) {
    if (entry.group !== state.group) fail("roster-chain");
    if (entry.seq !== state.seq + 1 || entry.prev !== state.head || entry.op === "genesis") {
      fail("roster-chain");
    }
  } else if (entry.op !== "genesis" || entry.seq !== 0 || entry.prev !== toHex(ZERO_HASH)) {
    fail("roster-chain");
  }
  checkShape(entry);

  const seen = new Set(state?.seen);
  const added = new Map<string, Member>();
  for (const subject of entry.add ?? []) added.set(subject.did, checkSubject(subject, seen));

  const signer = checkSigner(entry, state, added);
  const signers = [...new Set([entry.signer, ...added.keys()])];
  if (!sameSet(Object.keys(entry.sigs).sort(), signers)) fail("roster-signature");
  const message = signingBytes(entry);
  const signatures = signers.map((id) => ({
    key: id === entry.signer ? signer.sig : (added.get(id) as Member).sig,
    message,
    signature: fromB64(entry.sigs[id] as string),
  }));

  const members = new Map(state?.members);
  for (const id of entry.remove ?? []) {
    const member = members.get(id);
    const wanted = entry.op === "recovery" ? "recovery" : "device";
    if (!member || member.role !== wanted || (id === entry.signer) !== (entry.op === "leave")) {
      fail("roster-op");
    }
    members.delete(id);
  }
  if (entry.op === "leave" && ![...members.values()].some((m) => m.role === "device")) {
    fail("roster-op");
  }
  if (entry.op === "restore") members.set(entry.signer, { ...signer, used: true });
  for (const [id, member] of added) {
    members.set(id, member);
    seen.add(id);
  }

  if (entry.meta) {
    const keys = Object.keys(entry.meta);
    if (!keys.every((id) => members.has(id))) fail("roster-meta");
    if (
      entry.op === "rename" &&
      (keys.length !== 1 || members.get(keys[0] as string)?.role !== "device")
    ) {
      fail("roster-meta");
    }
  } else if (entry.op === "rename") {
    fail("roster-meta");
  }

  const epoch = entry.epoch ? entry.epoch.n : (state?.epoch ?? 0);
  if (entry.epoch) {
    if (entry.epoch.n !== (state ? state.epoch + 1 : 0)) fail("roster-epoch");
    if (!sameSet(entry.epoch.to, members.keys())) fail("roster-epoch");
  }

  return {
    state: {
      group: entry.group,
      seq: entry.seq,
      head: toHex(entryHash(entry)),
      epoch,
      kc: entry.epoch?.kc ?? (state?.kc as string),
      rotate: entry.op === "leave" || (!entry.epoch && (state?.rotate ?? false)),
      members,
      seen,
    },
    signatures,
  };
}

export function replayRoster(entries: Entry[]): RosterState {
  let state: RosterState | undefined;
  for (const entry of entries) state = applyEntry(state, entry);
  if (!state) fail("roster-chain");
  return state;
}

const RANK: Record<Op, number> = {
  remove: 0,
  leave: 1,
  recovery: 2,
  restore: 3,
  rotate: 4,
  add: 5,
  rename: 6,
  genesis: 7,
};

/** Picks the winner among valid entries competing for the same seq on a store without ordering. */
export function forkWinner(candidates: Entry[]): Entry {
  const ranked = candidates.map((entry) => ({ entry, hash: toHex(entryHash(entry)) }));
  ranked.sort((a, b) => RANK[a.entry.op] - RANK[b.entry.op] || (a.hash < b.hash ? -1 : 1));
  const winner = ranked[0];
  if (!winner) fail("roster-chain");
  return winner.entry;
}
