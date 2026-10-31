import { toHex } from "@flow-sync/protocol";

/** WebCrypto runs natively on Node and Workers; the pure-JS hash costs about 3 ms per MiB. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
