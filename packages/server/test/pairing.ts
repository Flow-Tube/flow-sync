import {
  agreementPublicKey,
  buildEntry,
  canonical,
  concat,
  decodePayload,
  type Entry,
  encodePayload,
  fromB64,
  fromHex,
  type Json,
  memberSubject,
  open,
  pairingAad,
  pairingKeys,
  pairingSlot,
  pairPath,
  randomBytes,
  seal,
  sign,
  signingBytes,
  toB64,
  toHex,
  utf8,
  wrapEpochKey,
} from "@flow-sync/protocol";
import type { SimDevice } from "./device.ts";

type Message = Record<string, Json>;

interface Keys {
  send: Uint8Array;
  receive: Uint8Array;
}

/** One side of the mailbox: seals what it sends, opens what the other side sent. */
function mailbox(device: SimDevice, slot: string, token: Uint8Array, me: "a" | "b") {
  const other = me === "a" ? "b" : "a";
  let keys: Keys | undefined;
  let sent = 0;
  let received = 0;
  const need = () => {
    if (!keys) throw new Error("pairing keys not derived yet");
    return keys;
  };
  return {
    useKeys(derived: Keys) {
      keys = derived;
    },
    async send(message: Message, prefix: Uint8Array = new Uint8Array()) {
      const seq = sent++;
      const sealed = seal(
        need().send,
        pairingAad(token, seq),
        encodePayload(utf8(canonical(message))),
      );
      const res = await device.fetch(`/v1/${pairPath(slot, me, seq)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: concat(prefix, sealed),
      });
      if (res.status !== 201) throw new Error(`mailbox put ${res.status}`);
    },
    async next(): Promise<Uint8Array> {
      const res = await device.fetch(`/v1/${pairPath(slot, other, received)}`);
      if (!res.ok) throw new Error(`mailbox get ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    open(sealed: Uint8Array): Message {
      const payload = open(need().receive, pairingAad(token, received++), sealed);
      return JSON.parse(new TextDecoder().decode(decodePayload(payload)));
    },
    async receive(): Promise<Message> {
      return this.open(await this.next());
    },
  };
}

/**
 * Runs pairing through the server mailbox, as protocol.md describes, with the member showing the
 * QR code. Returns the SAS each side would show, so the test can compare them like a user does.
 */
export async function pairThroughMailbox(member: SimDevice, joining: SimDevice, url: string) {
  const token = randomBytes(16);
  const showerSecret = randomBytes(32);
  const showerPublic = agreementPublicKey(showerSecret);
  const slot = toHex(pairingSlot(token));
  await member.json("/v1/pair", { slot });
  const shower = mailbox(member, slot, token, "a");
  const scanner = mailbox(joining, slot, token, "b");

  const scannerSecret = randomBytes(32);
  const scannerPublic = agreementPublicKey(scannerSecret);
  const b = pairingKeys(scannerSecret, showerPublic, token, showerPublic, scannerPublic);
  scanner.useKeys({ send: b.scannerKey, receive: b.showerKey });
  const join = {
    type: "join",
    sig: toB64(joining.keys.sigPublic),
    kem: toB64(joining.keys.kemPublic),
    meta: { app: "app", name: "Desktop", platform: "linux" },
  };
  await scanner.send(join, scannerPublic);

  const first = await shower.next();
  const theirPublic = first.subarray(0, 32);
  const a = pairingKeys(showerSecret, theirPublic, token, showerPublic, theirPublic);
  shower.useKeys({ send: a.showerKey, receive: a.scannerKey });
  const joined = shower.open(first.subarray(32));
  const state = await member.syncRoster();
  const kemPublic = fromB64(joined.kem as string);
  const subject = memberSubject(
    { sigPublic: fromB64(joined.sig as string), kemPublic, did: joining.keys.did },
    "device",
  );
  const draft = buildEntry(member.group, state, { op: "add", signer: member.did, add: [subject] }, [
    member.keys,
  ]);
  await shower.send({ type: "entry", entry: draft as unknown as Json });

  const proposed = (await scanner.receive()).entry as unknown as Entry;
  if (!proposed.add?.some((s) => s.did === joining.did)) throw new Error("entry doesn't add me");
  await scanner.send({
    type: "accept",
    sig: toB64(sign(joining.keys.sigSeed, signingBytes(proposed))),
  });

  const accepted = await shower.receive();
  const entry: Entry = { ...draft, sigs: { ...draft.sigs, [joining.did]: accepted.sig as string } };
  const wrap = await wrapEpochKey(
    kemPublic,
    member.group,
    state.epoch,
    joining.keys.did,
    member.epochKey(state.epoch),
  );
  const res = await member.fetch("/v1/roster", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `"${state.head}"` },
    body: JSON.stringify({ entry, wraps: { [joining.did]: toB64(wrap) } }),
  });
  if (res.status !== 201) throw new Error(`append ${res.status}`);
  const head = await member.syncRoster();
  await shower.send({
    type: "welcome",
    group: toHex(member.group),
    head: head.head,
    seq: head.seq,
    link: "default-link",
    store: { k: "server", u: url, i: member.instance },
  });

  const welcome = await scanner.receive();
  const store = welcome.store as Record<string, string>;
  joining.instance = store.i as string;
  joining.group = fromHex(welcome.group as string);
  await joining.signIn();
  await joining.syncRoster({ seq: welcome.seq as number, head: welcome.head as string });
  await joining.unwrapCurrent();
  await scanner.send({ type: "done" });
  await shower.receive();
  await member.fetch(`/v1/pair/${slot}`, { method: "DELETE" });
  return { showerSas: a.sas, scannerSas: b.sas };
}
