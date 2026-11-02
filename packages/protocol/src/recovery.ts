import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { EMPTY } from "./bytes.ts";
import { fail } from "./errors.ts";
import { derive } from "./kdf.ts";
import { type MemberSecrets, memberSecrets } from "./keys.ts";

export function recoveryWords(secret: Uint8Array): string {
  return entropyToMnemonic(secret, wordlist);
}

/** Throws on a wrong word, a wrong checksum, or anything but 24 words. */
export function recoverySecret(words: string): Uint8Array {
  const secret = mnemonicToEntropy(words.trim().toLowerCase().split(/\s+/).join(" "), wordlist);
  if (secret.length !== 32) fail("length");
  return secret;
}

export function recoveryKeys(secret: Uint8Array): MemberSecrets {
  return memberSecrets(
    derive(secret, EMPTY, "recovery sig", EMPTY, 32),
    derive(secret, EMPTY, "recovery kem", EMPTY, 32),
  );
}
