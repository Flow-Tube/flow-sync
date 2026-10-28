import { open, seal } from "./box.ts";
import { concat, toB64, toHex, u64, utf8 } from "./bytes.ts";
import { canonical } from "./canonical.ts";
import { ZERO_HASH } from "./envelope.ts";
import { epochCommitment, purposeKey } from "./epoch.ts";
import { tag } from "./kdf.ts";
import type { MemberKeys, MemberSecrets } from "./keys.ts";
import { decodePayload, encodePayload } from "./payload.ts";
import { type Entry, type Subject, signEntry } from "./roster.ts";

export type EntryDraft = Omit<Entry, "v" | "group" | "seq" | "prev" | "sigs">;

export interface DeviceMeta {
  app: string;
  name: string;
  platform: string;
}

export function memberSubject(member: MemberKeys, role: Subject["role"]): Subject {
  return {
    did: toHex(member.did),
    sig: toB64(member.sigPublic),
    kem: toB64(member.kemPublic),
    role,
  };
}

export function epochDraft(
  epochKey: Uint8Array,
  group: Uint8Array,
  n: number,
  members: MemberKeys[],
): NonNullable<Entry["epoch"]> {
  return {
    n,
    kc: toB64(epochCommitment(epochKey, group, n)),
    to: members.map((m) => toHex(m.did)).sort(),
  };
}

/** Builds the next entry after `previous` (the roster head) and signs it with every signer. */
export function buildEntry(
  group: Uint8Array,
  previous: { seq: number; head: string } | undefined,
  draft: EntryDraft,
  signers: MemberSecrets[],
): Entry {
  const unsigned: Entry = {
    v: 2,
    group: toHex(group),
    seq: previous ? previous.seq + 1 : 0,
    prev: previous ? previous.head : toHex(ZERO_HASH),
    ...draft,
    ...(draft.add && { add: [...draft.add].sort((a, b) => (a.did < b.did ? -1 : 1)) }),
    ...(draft.remove && { remove: [...draft.remove].sort() }),
    sigs: {},
  };
  return signers.reduce((e, m) => signEntry(e, toHex(m.did), m.sigSeed), unsigned);
}

const metaAad = (group: Uint8Array, seq: number, did: Uint8Array) =>
  concat(tag("meta"), group, u64(seq), did);

/** Seals a device's name for the entry at `seq`, under the roster key of the epoch after it. */
export function sealDeviceMeta(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  seq: number,
  did: Uint8Array,
  meta: DeviceMeta,
  salt?: Uint8Array,
): string {
  const payload = encodePayload(utf8(canonical({ ...meta })));
  const key = purposeKey(epochKey, group, epoch, "roster");
  return toB64(seal(key, metaAad(group, seq, did), payload, salt));
}

export function openDeviceMeta(
  epochKey: Uint8Array,
  group: Uint8Array,
  epoch: number,
  seq: number,
  did: Uint8Array,
  box: Uint8Array,
): string {
  const key = purposeKey(epochKey, group, epoch, "roster");
  return new TextDecoder().decode(decodePayload(open(key, metaAad(group, seq, did), box)));
}
