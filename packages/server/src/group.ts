import {
  canonical,
  checkEntry,
  type Entry,
  fail,
  fromB64,
  fromHex,
  type Json,
  parseEntry,
  type RosterState,
  randomBytes,
  type SignatureCheck,
  toHex,
  utf8,
  WRAP_SIZE,
} from "@flow-sync/protocol";
import { verifyAll } from "./crypto.ts";
import { HttpError } from "./http/errors.ts";
import { LIMITS } from "./limits.ts";
import type { MetaStore, RosterAppend } from "./storage/types.ts";

/** salt, commitment, a 32-byte key, tag. */
const CHAIN_SIZE = 112;

export interface Instance {
  id: Uint8Array;
  secret: Uint8Array;
}

/** Keys that live outside the group: they survive an admin reset. */
export const INSTANCE_SETTINGS = ["instance", "secret"];

function decode(value: string, length: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromB64(value);
  } catch {
    throw new HttpError("invalid");
  }
  if (bytes.length !== length) throw new HttpError("invalid");
  return bytes;
}

/**
 * An entry that starts an epoch carries a wrap for every member and, after genesis, the chain.
 * An add entry carries the new device's wrap of the current epoch. Other entries carry none.
 */
function epochKeys(
  entry: Entry,
  currentEpoch: number,
  wraps: Record<string, string>,
  chain: string | undefined,
): RosterAppend["keys"] {
  const added = entry.op === "add" ? (entry.add ?? []).map((s) => s.did) : [];
  const { n, to } = entry.epoch ?? { n: currentEpoch, to: added };
  const names = Object.keys(wraps).sort();
  const needsChain = entry.epoch !== undefined && n > 0;
  if (names.join() !== to.join() || needsChain !== (chain !== undefined)) {
    throw new HttpError("invalid");
  }
  const keys = names.map((did) => ({
    epoch: n,
    name: did,
    data: decode(wraps[did] as string, WRAP_SIZE),
  }));
  if (chain !== undefined) keys.push({ epoch: n, name: "chain", data: decode(chain, CHAIN_SIZE) });
  return keys;
}

async function verified(signatures: SignatureCheck[]): Promise<void> {
  if (!(await verifyAll(signatures))) fail("roster-signature");
}

/** Applies entries in order, checking all their signatures together. */
async function applyAll(state: RosterState | undefined, entries: Entry[]) {
  const signatures: SignatureCheck[] = [];
  for (const entry of entries) {
    const checked = checkEntry(state, entry);
    state = checked.state;
    signatures.push(...checked.signatures);
  }
  await verified(signatures);
  return state;
}

/** The instance identity and the group's roster, shared by every route. */
export class Group {
  readonly #meta: MetaStore;
  #state: RosterState | undefined;
  /** The stored JSON of the cached head, to notice a group replaced by another instance. */
  #head: string | undefined;
  #instance: Promise<Instance> | undefined;

  constructor(meta: MetaStore) {
    this.#meta = meta;
  }

  instance(): Promise<Instance> {
    this.#instance ??= (async () => {
      await this.#meta.setSettingOnce("instance", toHex(randomBytes(16)));
      await this.#meta.setSettingOnce("secret", toHex(randomBytes(32)));
      const [id, secret] = await Promise.all(
        INSTANCE_SETTINGS.map((k) => this.#meta.getSetting(k)),
      );
      return { id: fromHex(id as string), secret: fromHex(secret as string) };
    })();
    return this.#instance;
  }

  /**
   * Reads entries appended since the cached state, so appends by other server instances are seen,
   * and starts over when the cached head is gone after another instance's admin reset.
   */
  async roster(): Promise<RosterState | undefined> {
    for (;;) {
      const entries = await this.#meta.rosterAfter((this.#state?.seq ?? 0) - 1, LIMITS.rosterPage);
      const full = entries.length === LIMITS.rosterPage;
      if (this.#state && entries.shift() !== this.#head) {
        this.forget();
        continue;
      }
      this.#state = await applyAll(
        this.#state,
        entries.map((json) => parseEntry(JSON.parse(json))),
      );
      this.#head = entries.at(-1) ?? this.#head;
      if (!full) return this.#state;
    }
  }

  async claimed(): Promise<RosterState> {
    const state = await this.roster();
    if (!state) throw new HttpError("unclaimed");
    return state;
  }

  /** Validates an entry with its wraps and appends it, or fails with the current head. */
  async append(value: unknown, wraps: Record<string, string>, chain?: string): Promise<void> {
    if (utf8(JSON.stringify(value)).length > LIMITS.rosterEntry) throw new HttpError("too_large");
    const entry = parseEntry(value);
    const json = canonical(entry as Json);
    const before = await this.roster();
    const { state: after, signatures } = checkEntry(before, entry);
    await verified(signatures);
    const appended = await this.#meta.appendRoster({
      seq: entry.seq,
      prev: before?.head,
      hash: after.head,
      entry: json,
      keys: epochKeys(entry, before?.epoch ?? 0, wraps, chain),
    });
    if (!appended) throw new HttpError("conflict", { head: (await this.roster())?.head });
    this.#state = after;
    this.#head = json;
  }

  /** Drops the cached roster after the group is deleted. */
  forget(): void {
    this.#state = undefined;
    this.#head = undefined;
  }
}
