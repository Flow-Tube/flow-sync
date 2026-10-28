import {
  applyEntry,
  canonical,
  type Entry,
  fromB64,
  fromHex,
  type Json,
  parseEntry,
  type RosterState,
  randomBytes,
  toHex,
  WRAP_SIZE,
} from "@flow-sync/protocol";
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

function epochKeys(
  entry: Entry,
  wraps: Record<string, string>,
  chain: string | undefined,
): RosterAppend["keys"] {
  const names = Object.keys(wraps).sort();
  if (!entry.epoch) {
    if (names.length > 0 || chain !== undefined) throw new HttpError("invalid");
    return [];
  }
  const { n, to } = entry.epoch;
  if (names.join() !== to.join() || n > 0 !== (chain !== undefined)) throw new HttpError("invalid");
  const keys = names.map((did) => ({
    epoch: n,
    name: did,
    data: decode(wraps[did] as string, WRAP_SIZE),
  }));
  if (chain !== undefined) keys.push({ epoch: n, name: "chain", data: decode(chain, CHAIN_SIZE) });
  return keys;
}

/** The instance identity and the group's roster, shared by every route. */
export class Group {
  readonly #meta: MetaStore;
  #state: RosterState | undefined;
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

  /** Reads entries appended since the cached state, so appends by other server instances are seen. */
  async roster(): Promise<RosterState | undefined> {
    for (;;) {
      const entries = await this.#meta.rosterAfter(this.#state?.seq ?? -1, LIMITS.rosterPage);
      for (const json of entries)
        this.#state = applyEntry(this.#state, parseEntry(JSON.parse(json)));
      if (entries.length < LIMITS.rosterPage) return this.#state;
    }
  }

  async claimed(): Promise<RosterState> {
    const state = await this.roster();
    if (!state) throw new HttpError("unclaimed");
    return state;
  }

  /** Validates an entry with its wraps and appends it, or fails with the current head. */
  async append(entry: Entry, wraps: Record<string, string>, chain?: string): Promise<void> {
    const before = await this.roster();
    const after = applyEntry(before, entry);
    const appended = await this.#meta.appendRoster({
      seq: entry.seq,
      prev: before?.head,
      hash: after.head,
      entry: canonical(entry as Json),
      keys: epochKeys(entry, wraps, chain),
    });
    if (!appended) throw new HttpError("conflict", { head: (await this.roster())?.head });
    this.#state = after;
  }
}
