export type PutResult = "created" | "identical" | "conflict";

export interface ObjectRecord {
  path: string;
  did: string;
  /** SHA-256 of the bytes, hex; also the blob key. */
  hash: string;
  size: number;
}

export interface Change {
  cursor: number;
  path: string;
  size: number;
}

export interface RosterAppend {
  seq: number;
  /** Hash of the entry before; undefined for genesis. */
  prev: string | undefined;
  hash: string;
  entry: string;
  /** Wraps and chain boxes stored with the entry: name is a did or "chain". */
  keys: { epoch: number; name: string; data: Uint8Array }[];
}

/** Everything except object bytes. Every method is atomic. */
export interface MetaStore {
  getSetting(key: string): Promise<string | undefined>;
  /** Returns false when the key already exists. */
  setSettingOnce(key: string, value: string): Promise<boolean>;
  /** Deletes the group and everything in it except blobs; instance settings survive. */
  reset(keep: string[]): Promise<void>;

  rosterAfter(seq: number, limit: number): Promise<string[]>;
  /** Returns false when `prev` is no longer the head. */
  appendRoster(append: RosterAppend): Promise<boolean>;
  getKey(epoch: number, name: string): Promise<Uint8Array | undefined>;

  putObject(record: ObjectRecord): Promise<PutResult>;
  getObject(path: string): Promise<ObjectRecord | undefined>;
  deleteObject(path: string): Promise<ObjectRecord | undefined>;
  isHashUsed(hash: string): Promise<boolean>;
  changesAfter(cursor: number, limit: number): Promise<Change[]>;
  usage(): Promise<{ bytes: number; objects: number }>;

  touchDevice(did: string, at: number): Promise<void>;
  devices(): Promise<Record<string, number>>;

  putChallenge(id: string, did: string, expires: number): Promise<void>;
  /** Removes and returns a challenge, so each is used once. */
  takeChallenge(id: string): Promise<{ did: string; expires: number } | undefined>;

  /** Returns false when the slot exists or `max` live slots are open. */
  openSlot(slot: string, expires: number, max: number, now: number): Promise<boolean>;
  slotExpiry(slot: string): Promise<number | undefined>;
  putPairMessage(slot: string, name: string, data: Uint8Array): Promise<PutResult>;
  getPairMessage(slot: string, name: string): Promise<Uint8Array | undefined>;
  deleteSlot(slot: string): Promise<void>;
  /** Returns false when the id exists or `max` live requests are pending. */
  addJoinRequest(request: JoinRequest, max: number, now: number): Promise<boolean>;
  /** Live requests that no member answered or declined yet. */
  openJoinRequests(now: number): Promise<JoinRequest[]>;
  /** Returns false when the request is unknown, expired, already answered or declined. */
  answerJoinRequest(id: string, code: string, now: number): Promise<boolean>;
  /** Returns false when the request is unknown, expired, already answered or declined. */
  declineJoinRequest(id: string, now: number): Promise<boolean>;
  /** Undefined when the request is unknown or expired. */
  joinAnswer(id: string, now: number): Promise<JoinAnswer | undefined>;
  /** True when a live request with this id exists, answered or not. */
  hasJoinRequest(id: string, now: number): Promise<boolean>;
  /** Drops expired challenges, pairing slots and join requests. */
  purgeExpired(now: number): Promise<void>;
}

export interface JoinRequest {
  id: string;
  name: string;
  expires: number;
}

export interface JoinAnswer {
  code: string | undefined;
  declined: boolean;
}

/** Object stores keep blobs under this prefix, so clearing never touches the rest of a bucket. */
export const BLOB_PREFIX = "flow-sync/blobs/";

/** Object bytes, addressed by their SHA-256. */
export interface BlobStore {
  put(hash: string, data: Uint8Array): Promise<void>;
  get(hash: string): Promise<Uint8Array | undefined>;
  delete(hash: string): Promise<void>;
  /** Deletes every blob, for an admin reset. */
  clear(): Promise<void>;
}

export interface Storage {
  meta: MetaStore;
  blobs: BlobStore;
}
