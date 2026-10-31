import { isValidSigningKey, type SignatureCheck, toHex } from "@flow-sync/protocol";

// WebCrypto runs natively on Node and Workers. The pure-JS code costs about 3 ms per MiB hashed
// and about 1 ms per signature, too much for the Workers Free CPU limit.

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/**
 * Ed25519 behind the reference's key check (canonical, not small order), which makes it accept
 * exactly what the reference accepts; spec/vectors/ed25519.json is tested on both runtimes.
 */
export async function verifySignature({ key, message, signature }: SignatureCheck) {
  if (!isValidSigningKey(key) || signature.length !== 64) return false;
  const publicKey = await crypto.subtle.importKey("raw", bytes(key), "Ed25519", false, ["verify"]);
  return crypto.subtle.verify("Ed25519", publicKey, bytes(signature), bytes(message));
}

export async function verifyAll(checks: SignatureCheck[]): Promise<boolean> {
  return (await Promise.all(checks.map(verifySignature))).every(Boolean);
}

/** The protocol's arrays are always backed by an ArrayBuffer; WebCrypto's types want that said. */
const bytes = (array: Uint8Array) => array as Uint8Array<ArrayBuffer>;
