import { concat, EMPTY, u8, u64 } from "./bytes.ts";
import { derive, tag } from "./kdf.ts";

/** The mDNS TXT tag for one hour; members check the previous, current and next hour. */
export function lanTag(lanKey: Uint8Array, unixSeconds: number): Uint8Array {
  return derive(lanKey, EMPTY, "lan tag", u64(Math.floor(unixSeconds / 3600)), 8);
}

export function lanHelloAad(message: 1 | 2 | 3): Uint8Array {
  return concat(tag("lan hello"), u8(message));
}

export function lanTranscript(
  role: "server" | "client",
  clientNonce: Uint8Array,
  serverNonce: Uint8Array,
  clientDid: Uint8Array,
  serverDid: Uint8Array,
): Uint8Array {
  return concat(tag(`lan ${role}`), clientNonce, serverNonce, clientDid, serverDid);
}

export function lanSessionKeys(
  lanKey: Uint8Array,
  clientNonce: Uint8Array,
  serverNonce: Uint8Array,
  clientDid: Uint8Array,
  serverDid: Uint8Array,
) {
  const salt = concat(clientNonce, serverNonce);
  const dids = concat(clientDid, serverDid);
  return {
    clientToServer: derive(lanKey, salt, "lan c2s", dids, 32),
    serverToClient: derive(lanKey, salt, "lan s2c", dids, 32),
  };
}

export function lanFrameAad(seq: number): Uint8Array {
  return concat(tag("lan"), u64(seq));
}
