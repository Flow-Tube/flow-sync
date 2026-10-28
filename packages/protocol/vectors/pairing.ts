import {
  agreementPublicKey,
  canonical,
  encodePayload,
  lanFrameAad,
  lanHelloAad,
  lanSessionKeys,
  lanTag,
  lanTranscript,
  pairingAad,
  pairingKeys,
  pairingSlot,
  purposeKey,
  seal,
  toB64,
  utf8,
} from "../src/index.ts";
import { device, epochKeys, group, hex, rand, type Vectors } from "./fixtures.ts";

export function pairingVectors(): Vectors {
  const showerSecret = rand("shower ephemeral");
  const scannerSecret = rand("scanner ephemeral");
  const showerPublic = agreementPublicKey(showerSecret);
  const scannerPublic = agreementPublicKey(scannerSecret);
  const token = rand("pairing token", 16);
  const keys = pairingKeys(showerSecret, scannerPublic, token, showerPublic, scannerPublic);
  const join = canonical({
    kem: toB64(device.B.kemPublic),
    meta: { app: "app-desktop", name: "Desktop", platform: "macos" },
    sig: toB64(device.B.sigPublic),
    type: "join",
  });
  const salt = rand("pairing salt");
  return {
    showerSecret: hex(showerSecret),
    showerPublic: hex(showerPublic),
    scannerSecret: hex(scannerSecret),
    scannerPublic: hex(scannerPublic),
    token: hex(token),
    showerKey: hex(keys.showerKey),
    scannerKey: hex(keys.scannerKey),
    sas: keys.sas,
    slot: hex(pairingSlot(token)),
    message: {
      from: "scanner",
      seq: 0,
      aad: hex(pairingAad(token, 0)),
      content: join,
      salt: hex(salt),
      box: hex(seal(keys.scannerKey, pairingAad(token, 0), encodePayload(utf8(join)), salt)),
    },
  };
}

export function lanVectors(): Vectors {
  const lanKey = purposeKey(epochKeys[0] as Uint8Array, group, 0, "lan");
  const clientNonce = rand("lan client nonce");
  const serverNonce = rand("lan server nonce");
  const client = device.A.did;
  const server = device.C.did;
  const session = lanSessionKeys(lanKey, clientNonce, serverNonce, client, server);
  const unixSeconds = 1_793_232_000;
  return {
    lanKey: hex(lanKey),
    tag: { unixSeconds, tag: hex(lanTag(lanKey, unixSeconds)) },
    clientNonce: hex(clientNonce),
    serverNonce: hex(serverNonce),
    clientDid: hex(client),
    serverDid: hex(server),
    helloAad: [1, 2, 3].map((n) => hex(lanHelloAad(n as 1 | 2 | 3))),
    serverTranscript: hex(lanTranscript("server", clientNonce, serverNonce, client, server)),
    clientTranscript: hex(lanTranscript("client", clientNonce, serverNonce, client, server)),
    clientToServer: hex(session.clientToServer),
    serverToClient: hex(session.serverToClient),
    frameAad: hex(lanFrameAad(5)),
  };
}
