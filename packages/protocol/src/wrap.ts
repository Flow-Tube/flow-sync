import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { concat, u32 } from "./bytes.ts";
import { fail } from "./errors.ts";
import { tag } from "./kdf.ts";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export const WRAP_SIZE = 80;

const wrapInfo = (group: Uint8Array, epoch: number, did: Uint8Array) =>
  concat(tag("wrap"), group, u32(epoch), did);

/** Wraps an epoch key to one member. `ikmE` fixes the ephemeral key for test vectors only. */
export async function wrapEpochKey(
  kemPublic: Uint8Array,
  group: Uint8Array,
  epoch: number,
  did: Uint8Array,
  epochKey: Uint8Array,
  ikmE?: Uint8Array,
): Promise<Uint8Array> {
  const recipientPublicKey = await suite.kem.deserializePublicKey(kemPublic);
  const info = wrapInfo(group, epoch, did);
  const sender = await suite.createSenderContext(
    ikmE ? { recipientPublicKey, info, ekm: ikmE } : { recipientPublicKey, info },
  );
  const ciphertext = await sender.seal(epochKey);
  return concat(new Uint8Array(sender.enc), new Uint8Array(ciphertext));
}

export async function unwrapEpochKey(
  kemSecret: Uint8Array,
  group: Uint8Array,
  epoch: number,
  did: Uint8Array,
  wrap: Uint8Array,
): Promise<Uint8Array> {
  if (wrap.length !== WRAP_SIZE) fail("length");
  try {
    const recipient = await suite.createRecipientContext({
      recipientKey: await suite.kem.deserializePrivateKey(kemSecret),
      enc: wrap.slice(0, 32),
      info: wrapInfo(group, epoch, did),
    });
    return new Uint8Array(await recipient.open(wrap.slice(32)));
  } catch {
    fail("decrypt");
  }
}
