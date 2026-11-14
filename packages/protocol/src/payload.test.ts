import fc from "fast-check";
import { gzipSync } from "fflate";
import { expect, test } from "vitest";
import { concat } from "./bytes.ts";
import { FlowSyncError } from "./errors.ts";
import { decodePayload, encodePayload, padBody, paddedSize } from "./payload.ts";

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

const MAX_INFLATED = 64 * 1024 * 1024;

test("the inflate limit is exactly 64 MiB", () => {
  const body = (size: number) => padBody(gzipSync(new Uint8Array(size), { level: 1 }));
  expect(decodePayload(body(MAX_INFLATED)).length).toBe(MAX_INFLATED);
  expect(() => decodePayload(body(MAX_INFLATED + 1))).toThrow(FlowSyncError);
});

test("anything between the deflate stream and the trailer is refused, at any content size", () => {
  // zlib's output chunks are 16 KiB, so a stream can end exactly on one.
  for (const size of [0, 1, 16 * 1024 - 1, 16 * 1024, 16 * 1024 + 1, 64 * 1024]) {
    const member = gzipSync(new Uint8Array(size).fill(7), { mtime: 0 });
    const junk = concat(member.subarray(0, -8), new Uint8Array(3), member.subarray(-8));
    expect(decodePayload(padBody(member)).length).toBe(size);
    expect(() => decodePayload(padBody(junk))).toThrow(FlowSyncError);
  }
});

test("a body shorter than the header and trailer is refused", () => {
  const member = gzipSync(new Uint8Array(0), { mtime: 0 });
  for (let length = 0; length < member.length; length++) {
    expect(() => decodePayload(padBody(member.subarray(0, length)))).toThrow(FlowSyncError);
  }
});
