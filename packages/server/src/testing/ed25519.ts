import { fromHex } from "@flow-sync/protocol";
import { expect, test } from "vitest";
import vectors from "../../../../spec/vectors/ed25519.json" with { type: "json" };
import { verifySignature } from "../crypto.ts";

/** The native verifier must accept exactly what the reference does, on every runtime. */
export function ed25519VectorTests(runtime: string) {
  test(`${runtime} Ed25519 matches spec/vectors/ed25519.json`, async () => {
    for (const c of vectors.cases) {
      const check = {
        key: fromHex(c.publicKey),
        message: fromHex(c.message),
        signature: fromHex(c.signature),
      };
      expect(await verifySignature(check), c.name).toBe(c.valid);
    }
    const valid = vectors.cases.find((c) => c.valid);
    for (const key of [...vectors.weakKeys, ...vectors.nonCanonicalKeys]) {
      const check = {
        key: fromHex(key),
        message: fromHex(valid?.message ?? ""),
        signature: fromHex(valid?.signature ?? ""),
      };
      expect(await verifySignature(check), key).toBe(false);
    }
  });
}
