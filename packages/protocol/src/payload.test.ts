import fc from "fast-check";
import { expect, test } from "vitest";
import { FlowSyncError } from "./errors.ts";
import { decodePayload, encodePayload, paddedSize } from "./payload.ts";

test("payloads round-trip and are padded", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 4096 }), (content) => {
      const payload = encodePayload(content);
      expect(payload.length).toBe(paddedSize(payload.length));
      expect(decodePayload(payload)).toEqual(content);
    }),
  );
});

test("padding never shrinks and stays within 12 percent", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2 ** 30 }), (n) => {
      const padded = paddedSize(n);
      expect(padded).toBeGreaterThanOrEqual(n);
      if (n > 256) expect(padded / n).toBeLessThanOrEqual(1.12);
    }),
  );
});

test("arbitrary bytes are rejected with a protocol error, never a crash", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
      try {
        decodePayload(bytes);
      } catch (error) {
        expect(error).toBeInstanceOf(FlowSyncError);
      }
    }),
  );
});
