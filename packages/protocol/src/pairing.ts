import { concat, readU32, u64 } from "./bytes.ts";
import { agree } from "./curve.ts";
import { derive, labeledHash, tag } from "./kdf.ts";

export interface PairingKeys {
  /** Seals messages from the device showing the code. */
  showerKey: Uint8Array;
  /** Seals messages from the scanner. */
  scannerKey: Uint8Array;
  sas: string;
}

export function pairingKeys(
  ownSecret: Uint8Array,
  peerPublic: Uint8Array,
  token: Uint8Array,
  showerPublic: Uint8Array,
  scannerPublic: Uint8Array,
): PairingKeys {
  const shared = agree(ownSecret, peerPublic);
  const transcript = concat(showerPublic, scannerPublic);
  const sas = readU32(derive(shared, token, "sas", transcript, 4), 0) & 0x7fffffff;
  return {
    showerKey: derive(shared, token, "pair a2b", transcript, 32),
    scannerKey: derive(shared, token, "pair b2a", transcript, 32),
    sas: String(sas % 1_000_000).padStart(6, "0"),
  };
}

export function pairingAad(token: Uint8Array, seq: number): Uint8Array {
  return concat(tag("pair"), token, u64(seq));
}

export function pairingSlot(token: Uint8Array): Uint8Array {
  return labeledHash("pair", token).subarray(0, 16);
}
