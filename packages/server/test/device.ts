import {
  applyEntry,
  checkEpochKey,
  concat,
  decodePayload,
  type Entry,
  encodePayload,
  fromB64,
  fromHex,
  logPath,
  type MemberSecrets,
  nextInStream,
  ObjectType,
  openChain,
  openObject,
  parseDevicePath,
  parseObject,
  purposeKey,
  purposeOf,
  type RosterState,
  type StreamPosition,
  sealObject,
  sha256,
  sign,
  tag,
  toB64,
  toHex,
  unwrapEpochKey,
  utf8,
  verifyObject,
  ZERO_HASH,
} from "@flow-sync/protocol";

/** A device (or the recovery key) that speaks FLOW-SYNC/2 to a server over HTTP. */
export class SimDevice {
  readonly keys: MemberSecrets;
  readonly #base: string;
  #token = "";
  group = new Uint8Array();
  instance = "";
  state: RosterState | undefined;
  readonly #epochKeys = new Map<number, Uint8Array>();
  readonly #signingKeys = new Map<string, Uint8Array>();
  readonly #streams = new Map<string, StreamPosition>();
  #seq = 0;
  #prev: Uint8Array = ZERO_HASH;

  constructor(base: string, keys: MemberSecrets) {
    this.#base = base;
    this.keys = keys;
  }

  get did(): string {
    return toHex(this.keys.did);
  }

  fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    return fetch(`${this.#base}${path}`, { ...init, headers });
  }

  async json<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    const res = await this.fetch(path, init);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  async signIn(): Promise<void> {
    this.#token = "";
    const { challenge, instance, group } = await this.json<{
      challenge: string;
      instance: string;
      group: string;
    }>("/v1/auth/challenge", { did: this.did });
    if (this.instance && instance !== this.instance) throw new Error("instance changed");
    if (this.group.length === 0) this.group = fromHex(group);
    this.instance = instance;
    const message = concat(tag("auth"), fromHex(instance), this.group, fromB64(challenge));
    const sig = toB64(sign(this.keys.sigSeed, message));
    this.#token = (
      await this.json<{ token: string }>("/v1/auth/token", { did: this.did, challenge, sig })
    ).token;
  }

  /** Verifies every new roster entry; refuses a history that disagrees with a pinned head. */
  async syncRoster(pinned?: { seq: number; head: string }): Promise<RosterState> {
    const after = this.state?.seq ?? -1;
    const { entries } = await this.json<{ entries: Entry[] }>(`/v1/roster?after=${after}`);
    for (const entry of entries) {
      this.state = applyEntry(this.state, entry);
      for (const subject of entry.add ?? [])
        this.#signingKeys.set(subject.did, fromB64(subject.sig));
      if (pinned && this.state.seq === pinned.seq && this.state.head !== pinned.head) {
        throw new Error("roster fork");
      }
    }
    if (!this.state) throw new Error("empty roster");
    return this.state;
  }

  /** Unwraps this member's key for the current epoch and checks it against the roster. */
  async unwrapCurrent(): Promise<Uint8Array> {
    const state = await this.syncRoster();
    const res = await this.fetch(
      `/v1/keys/${state.epoch.toString(16).padStart(8, "0")}/${this.did}.k`,
    );
    if (!res.ok) throw new Error(`no wrap: ${res.status}`);
    const wrap = new Uint8Array(await res.arrayBuffer());
    const key = await unwrapEpochKey(
      this.keys.kemSecret,
      this.group,
      state.epoch,
      this.keys.did,
      wrap,
    );
    checkEpochKey(key, this.group, state.epoch, fromB64(state.kc));
    this.#epochKeys.set(state.epoch, key);
    return key;
  }

  async readChain(epoch: number): Promise<Uint8Array> {
    const res = await this.fetch(`/v1/keys/${epoch.toString(16).padStart(8, "0")}/chain.k`);
    const previous = openChain(
      this.epochKey(epoch),
      this.group,
      epoch,
      new Uint8Array(await res.arrayBuffer()),
    );
    this.#epochKeys.set(epoch - 1, previous);
    return previous;
  }

  epochKey(epoch: number): Uint8Array {
    const key = this.#epochKeys.get(epoch);
    if (!key) throw new Error(`no key for epoch ${epoch}`);
    return key;
  }

  learnEpochKey(epoch: number, key: Uint8Array): void {
    this.#epochKeys.set(epoch, key);
  }

  async write(content: string, type: ObjectType = ObjectType.changes): Promise<Response> {
    const state = await this.syncRoster();
    this.#seq += 1;
    const header = {
      type,
      group: this.group,
      epoch: state.epoch,
      sender: this.keys.did,
      seq: this.#seq,
      prev: this.#prev,
    };
    const key = purposeKey(this.epochKey(state.epoch), this.group, state.epoch, purposeOf(type));
    const bytes = sealObject(header, key, encodePayload(utf8(content)), this.keys.sigSeed);
    this.#prev = sha256(bytes);
    return this.fetch(`/v1/objects/${logPath(this.did, this.#seq)}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
  }

  /** Reads every object of other devices in the order store.md requires, checking each one. */
  async read(): Promise<string[]> {
    const state = await this.syncRoster();
    const { objects } = await this.json<{ objects: { path: string }[] }>("/v1/changes?after=0");
    const contents: string[] = [];
    for (const { path } of objects) {
      const target = parseDevicePath(path);
      if (target?.kind !== "log" || target.did === this.did) continue;
      const position = this.#streams.get(target.did);
      if (position && target.seq <= position.seq) continue;
      const res = await this.fetch(`/v1/objects/${path}`);
      const object = parseObject(new Uint8Array(await res.arrayBuffer()), this.group);
      const signingKey = this.#signingKeys.get(toHex(object.header.sender));
      if (!signingKey || toHex(object.header.sender) !== target.did)
        throw new Error("unknown sender");
      verifyObject(object, signingKey);
      if (object.header.seq !== target.seq) throw new Error("replayed object");
      this.#streams.set(target.did, nextInStream(position, object));
      const { epoch, type } = object.header;
      const key = purposeKey(this.epochKey(epoch), fromHex(state.group), epoch, purposeOf(type));
      contents.push(new TextDecoder().decode(decodePayload(openObject(object, key))));
    }
    return contents;
  }
}
