import { wordlist } from "@scure/bip39/wordlists/english.js";
import fc from "fast-check";
import { expect, test } from "vitest";
import { recoverySecret, recoveryWords } from "./recovery.ts";
import { fuzzRuns } from "./testing/fuzz.ts";

test("recovery words round-trip in any case and spacing", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (secret) => {
      const words = recoveryWords(secret).toUpperCase().split(" ").join(" \n\t ");
      expect(recoverySecret(`  ${words} `)).toEqual(secret);
    }),
    fuzzRuns(),
  );
});

test("valid shorter phrases are refused", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(16, 20, 24, 28).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
      (entropy) => {
        expect(() => recoverySecret(recoveryWords(entropy))).toThrow();
      },
    ),
    fuzzRuns(),
  );
});

test("any accepted list of words gives a 32-byte secret", () => {
  const words = fc.array(fc.constantFrom(...wordlist), { minLength: 1, maxLength: 30 });
  fc.assert(
    fc.property(words, (list) => {
      let secret: Uint8Array | undefined;
      try {
        secret = recoverySecret(list.join(" "));
      } catch {
        return;
      }
      expect(secret.length).toBe(32);
    }),
    fuzzRuns(),
  );
});
