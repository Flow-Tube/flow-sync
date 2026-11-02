import fc from "fast-check";
import { expect } from "vitest";
import { concat } from "../bytes.ts";
import { FlowSyncError } from "../errors.ts";

/** `FLOW_SYNC_FUZZ_RUNS` raises the runs per property for a longer local campaign. */
export const fuzzRuns = (runs = 100) => ({
  numRuns: Number(process.env.FLOW_SYNC_FUZZ_RUNS) || runs,
});

/** Input may be refused, but only with a protocol error. */
export async function refusedCleanly(decode: () => unknown): Promise<void> {
  try {
    await decode();
  } catch (error) {
    expect(error).toBeInstanceOf(FlowSyncError);
  }
}

export async function refused(decode: () => unknown): Promise<void> {
  await expect(async () => decode()).rejects.toBeInstanceOf(FlowSyncError);
}

/** One-bit flips, truncations and extensions of `valid`. */
export function mutations(valid: Uint8Array): fc.Arbitrary<Uint8Array> {
  const last = valid.length - 1;
  return fc.oneof(
    fc.tuple(fc.nat(last), fc.nat(7)).map(([at, bit]) => {
      const copy = valid.slice();
      copy[at] = (copy[at] as number) ^ (1 << bit);
      return copy;
    }),
    fc.nat(last).map((length) => valid.slice(0, length)),
    fc.uint8Array({ minLength: 1, maxLength: 64 }).map((extra) => concat(valid, extra)),
  );
}
