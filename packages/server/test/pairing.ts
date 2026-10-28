import {
  agreementPublicKey,
  buildEntry,
  canonical,
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

/** One side of the mailbox: seals what it sends, opens what the other side sent. */
function mailbox(
  device: SimDevice,
  slot: string,
  token: Uint8Array,
  keys: { send: Uint8Array; receive: Uint8Array },
  me: "a" | "b",
) {
  const other = me === "a" ? "b" : "a";
  let sent = 0;
  let received = 0;
  return {
    async send(message: Message) {
      const seq = sent++;
      const box = seal(keys.send, pairingAad(token, seq), encodePayload(utf8(canonical(message))));
      const res = await device.fetch(`/v1/${pairPath(slot, me, seq)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: box,
      });
      if (res.status !== 201) throw new Error(`mailbox put ${res.status}`);
    },
    async receive(): Promise<Message> {
      const seq = received++;
      const res = await device.fetch(`/v1/${pairPath(slot, other, seq)}`);
      if (!res.ok) throw new Error(`mailbox get ${res.status}`);
      const box = new Uint8Array(await res.arrayBuffer());
      return JSON.parse(
        new TextDecoder().decode(decodePayload(open(keys.receive, pairingAad(token, seq), box))),
      );
    },
  };
}

/**
 * Runs pairing through the server mailbox, as protocol.md describes, with the member showing the
 * QR code. Returns the SAS each side would show, so the test can compare them like a user does.
 */
export async function pairThroughMailbox(member: SimDevice, joining: SimDevice) {
  const token = randomBytes(16);
  const showerSecret = randomBytes(32);
  const scannerSecret = randomBytes(32);
  const showerPublic = agreementPublicKey(showerSecret);
  const scannerPublic = agreementPublicKey(scannerSecret);
  const slot = toHex(pairingSlot(token));
  await member.json("/v1/pair", { slot });

  const a = pairingKeys(showerSecret, scannerPublic, token, showerPublic, scannerPublic);
  const b = pairingKeys(scannerSecret, showerPublic, token, showerPublic, scannerPublic);
  const shower = mailbox(member, slot, token, { send: a.showerKey, receive: a.scannerKey }, "a");
  const scanner = mailbox(joining, slot, token, { send: b.scannerKey, receive: b.showerKey }, "b");

  await scanner.send({
    type: "join",
    sig: toB64(joining.keys.sigPublic),
    kem: toB64(joining.keys.kemPublic),
    meta: { app: "app", name: "Desktop", platform: "linux" },
  });
  const join = await shower.receive();
  const state = await member.syncRoster();
  const kemPublic = fromB64(join.kem as string);
  const subject = memberSubject(
    { sigPublic: fromB64(join.sig as string), kemPublic, did: joining.keys.did },
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
    instance: member.instance,
    seq: head.seq,
    head: head.head,
  });

  const welcome = await scanner.receive();
  joining.instance = welcome.instance as string;
  joining.group = fromHex(welcome.group as string);
  await joining.signIn();
  await joining.syncRoster({ seq: welcome.seq as number, head: welcome.head as string });
  await joining.unwrapCurrent();
  await scanner.send({ type: "done" });
  await shower.receive();
  await member.fetch(`/v1/pair/${slot}`, { method: "DELETE" });
  return { showerSas: a.sas, scannerSas: b.sas };
}
