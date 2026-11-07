import { ED25519_TORSION_SUBGROUP, ed25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concat, fromHex, sign, utf8 } from "../src/index.ts";
import { device, flip, hex, rand, type Vectors } from "./fixtures.ts";
import { SPECCHECK } from "./speccheck.ts";

const { Point } = ed25519;
const L = Point.Fn.ORDER;
const IDENTITY = fromHex(ED25519_TORSION_SUBGROUP[0] as string);
const ORDER_8 = Point.fromHex(ED25519_TORSION_SUBGROUP[1] as string);
const ORDER_4 = Point.fromHex(ED25519_TORSION_SUBGROUP[2] as string);
const ORDER_2 = Point.fromHex(ED25519_TORSION_SUBGROUP[4] as string);
/** y >= p, or x = 0 with the sign bit set: the small-order points' other spellings. */
const NON_CANONICAL_SMALL_ORDER = [
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "0100000000000000000000000000000000000000000000000000000000000080",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
];

const toScalar = (bytes: Uint8Array) => BigInt(`0x${hex(bytes.slice().reverse())}`);

function fromScalar(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

export interface CraftedKey {
  secret: bigint;
  key: Uint8Array;
}

const signingKey = (seed: Uint8Array): CraftedKey => {
  const { scalar, pointBytes } = ed25519.utils.getExtendedPublicKey(seed);
  return { secret: scalar, key: pointBytes };
};

/** A key with a torsion part: order 8L by default. */
export function mixedOrderKey(seed: Uint8Array, torsion = ORDER_8): CraftedKey {
  const { scalar, point } = ed25519.utils.getExtendedPublicKey(seed);
  return { secret: scalar, key: point.add(torsion).toBytes() };
}

const challenge = (R: Uint8Array, key: Uint8Array, message: Uint8Array) =>
  toScalar(sha512(concat(R, key, message))) % L;

/** R ‖ S for any chosen R, with S = r + k·a. */
function craft({ secret, key }: CraftedKey, R: Uint8Array, r: bigint, message: Uint8Array) {
  return concat(R, fromScalar((r + challenge(R, key, message) * secret) % L));
}

/** The first honest nonce whose k passes `wanted`; a torsion part in the key cancels when 8 | k. */
function nonceWhere(signer: CraftedKey, message: Uint8Array, wanted: (k: bigint) => boolean) {
  for (let i = 0; ; i++) {
    const r = toScalar(rand(`signature nonce ${i}`)) % L;
    const R = Point.BASE.multiply(r).toBytes();
    if (wanted(challenge(R, signer.key, message))) return { r, R };
  }
}

/** Holds under the cofactorless and cofactored equations alike, even for a mixed-order key. */
export function signBothEquations(signer: CraftedKey, message: Uint8Array): Uint8Array {
  const { r, R } = nonceWhere(signer, message, (k) => k % 8n === 0n);
  return craft(signer, R, r, message);
}

/** R is the identity, so S = k·a passes the cofactorless equation. */
export function signIdentityR(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return craft(signingKey(seed), IDENTITY, 0n, message);
}

function addOrderToS(signature: Uint8Array): Uint8Array {
  return concat(signature.subarray(0, 32), fromScalar(toScalar(signature.subarray(32)) + L));
}

export function ed25519Vectors(): Vectors {
  const message = utf8("FLOW-SYNC/2 vector message");
  const signature = sign(device.A.sigSeed, message);
  const honest = signingKey(device.A.sigSeed);
  const mixed = mixedOrderKey(device.A.sigSeed);
  const refused = (name: string, key: Uint8Array, signed: Uint8Array) => ({
    name,
    key,
    message,
    signature: signed,
    valid: false,
  });
  const { r, R } = nonceWhere(honest, message, () => true);
  const withTorsion = (torsion: typeof ORDER_8) => Point.BASE.multiply(r).add(torsion).toBytes();
  const cofactoredOnly = nonceWhere(mixed, message, (k) => k % 8n !== 0n);
  const cases = [
    { name: "valid", key: device.A.sigPublic, message, signature, valid: true },
    {
      name: "tampered-message",
      key: device.A.sigPublic,
      message: flip(message, 0),
      signature,
      valid: false,
    },
    { name: "wrong-key", key: device.B.sigPublic, message, signature, valid: false },
    {
      name: "non-canonical-s",
      key: device.A.sigPublic,
      message,
      signature: addOrderToS(signature),
      valid: false,
    },
    {
      name: "small-order-key",
      key: IDENTITY,
      message,
      signature: concat(IDENTITY, new Uint8Array(32)),
      valid: false,
    },
    {
      name: "valid-chosen-nonce",
      key: honest.key,
      message,
      signature: craft(honest, R, r, message),
      valid: true,
    },
    refused("identity-r", honest.key, craft(honest, IDENTITY, 0n, message)),
    ...ED25519_TORSION_SUBGROUP.slice(1).map((point, i) =>
      refused(`small-order-r-${i + 1}`, honest.key, craft(honest, fromHex(point), 0n, message)),
    ),
    ...NON_CANONICAL_SMALL_ORDER.map((point, i) =>
      refused(`non-canonical-r-${i}`, honest.key, craft(honest, fromHex(point), 0n, message)),
    ),
    refused("mixed-order-r-8", honest.key, craft(honest, withTorsion(ORDER_8), r, message)),
    refused("mixed-order-r-4", honest.key, craft(honest, withTorsion(ORDER_4), r, message)),
    refused("mixed-order-r-2", honest.key, craft(honest, withTorsion(ORDER_2), r, message)),
    refused("mixed-order-key-both-equations", mixed.key, signBothEquations(mixed, message)),
    refused(
      "mixed-order-key-cofactored-only",
      mixed.key,
      craft(mixed, cofactoredOnly.R, cofactoredOnly.r, message),
    ),
    ...SPECCHECK.map((c, i) => ({
      name: `speccheck-${i}`,
      key: fromHex(c.publicKey),
      message: fromHex(c.message),
      signature: fromHex(c.signature),
      valid: false,
    })),
  ];
  return {
    weakKeys: ED25519_TORSION_SUBGROUP,
    // y = p + 3: a valid point of large order, but not the canonical encoding.
    nonCanonicalKeys: [
      "f0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      ...NON_CANONICAL_SMALL_ORDER,
    ],
    mixedOrderKeys: [
      mixed.key,
      ...[ORDER_4, ORDER_2].map((t) => mixedOrderKey(device.A.sigSeed, t).key),
    ].map(hex),
    cases: cases.map((c) => ({
      name: c.name,
      publicKey: hex(c.key),
      message: hex(c.message),
      signature: hex(c.signature),
      valid: c.valid,
    })),
  };
}
