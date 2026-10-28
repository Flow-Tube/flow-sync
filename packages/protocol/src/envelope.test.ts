import fc from "fast-check";
import { expect, test } from "vitest";
import { randomBytes } from "./bytes.ts";
import {
  type Header,
  MIN_OBJECT_SIZE,
  ObjectType,
  openObject,
  parseObject,
  sealObject,
  verifyObject,
  ZERO_HASH,
} from "./envelope.ts";
import { FlowSyncError } from "./errors.ts";
import { memberSecrets } from "./keys.ts";
import { encodePayload } from "./payload.ts";

const group = randomBytes(16);
const sender = memberSecrets(randomBytes(32), randomBytes(32));
const key = randomBytes(32);

test("sealed objects parse, verify and open", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...Object.values(ObjectType)),
      fc.integer({ min: 0, max: 2 ** 32 - 1 }),
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      fc.uint8Array({ maxLength: 2048 }),
      (type, epoch, seq, content) => {
        const header: Header = { type, group, epoch, sender: sender.did, seq, prev: ZERO_HASH };
        const payload = encodePayload(content);
        const object = parseObject(sealObject(header, key, payload, sender.sigSeed), group);
        expect(object.header).toEqual(header);
        verifyObject(object, sender.sigPublic);
        expect(openObject(object, key)).toEqual(payload);
      },
    ),
    { numRuns: 50 },
  );
});

test("arbitrary bytes are rejected with a protocol error, never a crash", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: MIN_OBJECT_SIZE - 1, maxLength: 1024 }), (bytes) => {
      try {
        verifyObject(parseObject(bytes, group), sender.sigPublic);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(FlowSyncError);
      }
    }),
  );
});
