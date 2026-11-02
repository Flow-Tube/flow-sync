# Cryptography

Every construction here is a standard one with a maintained, audited implementation on Android (minSdk 26), in Rust, and in TypeScript. Implementations MUST NOT write their own versions of these primitives.

## Suite 1

The object envelope's suite byte names the algorithms. FLOW-SYNC/2 defines suite `0x01`:

| Use | Algorithm |
|---|---|
| Signatures | Ed25519, [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032), with the checks below |
| Key agreement | X25519, [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748) |
| Key wrapping | HPKE base mode, [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180): KEM `0x0020` DHKEM(X25519, HKDF-SHA256), KDF `0x0001` HKDF-SHA256, AEAD `0x0002` AES-256-GCM |
| Key derivation | HKDF-SHA256, [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) |
| Hash | SHA-256 |
| Encryption | AES-256-GCM, 96-bit nonce, 128-bit tag, with a fresh key per box (below) |
| Compression | gzip, [RFC 1952](https://www.rfc-editor.org/rfc/rfc1952) |
| Padding | PADMÉ with a 256-byte minimum |

### Implementations

| | Android | Desktop | Reference and server |
|---|---|---|---|
| Ed25519, X25519 | BouncyCastle `bcprov-jdk18on` (`Ed25519`, `X25519`); Conscrypt's API can't derive a public key from a seed, which recovery keys need | `ed25519-dalek`, `x25519-dalek` | `@noble/curves` |
| HPKE | Conscrypt 2.6.1, already bundled in Flow (`Conscrypt.newProvider()`, `HpkeContextSender`/`HpkeContextRecipient`) | `hpke` | `@hpke/core` |
| HKDF, HMAC, SHA-256 | JCE `HmacSHA256`, `SHA-256` | `hkdf`, `hmac`, `sha2` | `@noble/hashes` |
| AES-256-GCM | JCE `AES/GCM/NoPadding` | `aes-gcm` | `@noble/ciphers` |

The server only verifies Ed25519 signatures and computes hashes. It never unwraps or decrypts.

## Ed25519 checks

Verification MUST use the cofactorless equation `[S]B = R + [k]A` and MUST reject:

- `S ≥ L` (the group order);
- a non-canonical encoding of `A` or `R` (a y-coordinate ≥ 2<sup>255</sup> − 19);
- a public key `A` whose encoding is one of the eight canonical encodings of a small-order point (listed in `vectors/ed25519.json`).

Honest signers never produce these cases, so the rules only matter for hostile input. Without them, two implementations could disagree about one signature, and devices could disagree about the roster.

## X25519 checks

Any X25519 output used by this protocol, inside or outside HPKE, MUST be rejected if it is all zeros.

## Labelled derivation

All keys come from one helper:

```
Derive(ikm, salt, label, context, L) =
    HKDF-Expand(HKDF-Extract(salt, ikm), "FLOW-SYNC/2 " ‖ label ‖ 0x00 ‖ context, L)
```

An empty `salt` is the empty string (HKDF then uses 32 zero bytes). Labels are fixed ASCII strings, and the `0x00` separator keeps every label distinct from every other label plus context.

Labelled hash, used for identifiers:

```
Hash(label, data) = SHA-256("FLOW-SYNC/2 " ‖ label ‖ 0x00 ‖ data)
```

## Keys

### Device keys

Device keys belong to one membership of one group. A device generates fresh ones when it creates a group, joins one (by pairing, including with the admin token) and restores one with the recovery key:

- `sig`: an Ed25519 key pair (32-byte seed);
- `kem`: an X25519 key pair (32-byte private key).

Its device id is `did = Hash("device", sig_pub ‖ kem_pub)[0..16]`.

A device deletes its device keys, with the group's epoch keys, after it [leaves](protocol.md#leaving) or learns it was [removed](protocol.md#removal). A device that joins again therefore has a new `did`, which the roster accepts because it has never seen it, and starts a new log.

Private keys never leave the device. They are stored encrypted by a platform key: on Android with the existing Keystore AES-GCM helper, on Desktop in the OS keychain.

### Epoch keys

The group key of epoch `e` is `K_e`, 32 bytes from the CSPRNG. Epochs are numbered from 0 at genesis. A new epoch starts when a device is removed, when a device rotates after another one left, when the group is restored with the recovery key, and when the recovery key changes ([protocol.md](protocol.md)).

```
kc_e   = Derive(K_e, group, "epoch", u32(e), 32)          epoch commitment, in the signed roster entry
P_e,x  = Derive(K_e, group, "key " ‖ x, u32(e), 32)       purpose key
```

| Purpose `x` | Protects |
|---|---|
| `roster` | Device names and platforms in roster entries |
| `changes` | Change batches |
| `snapshot` | Snapshot manifests and their blobs |
| `ack` | Acknowledgements |
| `live` | Live channel messages |
| `lan` | LAN discovery tags and LAN sessions |
| `chain` | The previous epoch's key |

`group` is the 16-byte group id.

### Wrapping an epoch key

`K_e` reaches each member as an HPKE base-mode wrap to the member's `kem_pub`:

```
info = "FLOW-SYNC/2 wrap" ‖ group ‖ u32(e) ‖ did
wrap = enc (32) ‖ HPKE.Seal(kem_pub, info, aad = "", pt = K_e)   (48)
```

A wrap is 80 bytes. Wraps are not signed. The receiver MUST check that the unwrapped key's `kc_e` equals the `kc` in the signed roster entry that started epoch `e`. That check also defeats a member who wraps different keys to different members.

### History chain

When epoch `e > 0` starts, the device that starts it also writes:

```
chain_e = Box(P_e,chain, "FLOW-SYNC/2 chain" ‖ group ‖ u32(e), K_(e-1))
```

A member holding `K_e` can walk back to older epochs and read objects that garbage collection hasn't removed yet. Each recovered `K_(e-1)` MUST match `kc_(e-1)`.

## Box

A box is the only way data is encrypted. It uses AES-256-GCM with a key derived per box from a random salt:

```
s                     = 32 bytes from the CSPRNG
key ‖ nonce ‖ commit  = Derive(P, s, "box", "", 76)       32 ‖ 12 ‖ 32 bytes
ct ‖ tag              = AES-256-GCM-Seal(key, nonce, aad, pt)
Box(P, aad, pt)       = s ‖ commit ‖ ct ‖ tag
```

To open, recompute `key ‖ nonce ‖ commit` from `P` and `s`, compare `commit` in constant time, and only then run AES-GCM-Open.

- **No nonce limit.** Each box has its own key, so the 2<sup>32</sup> limit on random nonces per key ([NIST SP 800-38D §8.3](https://csrc.nist.gov/pubs/sp/800/38/d/final)) never applies, however many boxes the devices of an epoch write offline.
- **Key commitment.** AES-GCM alone isn't committing: one ciphertext can be built to open under two keys. `commit` binds the box to one key.

## Payload encoding

Any user content (change batches, snapshot blobs, acks, live messages, device names) is encoded before boxing:

```
body    = gzip(content)
n       = 4 + len(body)
padded  = Pad(n)
payload = u32(len(body)) ‖ body ‖ 0x00 × (padded − n)
```

`Pad(n)` is 256 for `n ≤ 256`, and otherwise PADMÉ:

```
E = floor(log2(n));  S = floor(log2(E)) + 1
mask = 2^(E − S) − 1
Pad(n) = (n + mask) & ~mask
```

PADMÉ ([Nikitin et al., PoPETs 2019](https://petsymposium.org/popets/2019/popets-2019-0056.php)) leaks O(log log n) bits of length with at most 12 % overhead.

Decoders MUST reject a payload whose length field exceeds the payload, whose padding isn't all zeros, or whose gzip stream inflates beyond 64 MiB.

Compressing before encrypting leaks information only when an attacker can put chosen text next to a secret in the same compressed stream and watch the sizes many times. Each payload is compressed alone, padding hides fine-grained sizes, and no attacker-controlled input is mixed with secrets in one payload.

## Pairing

Pairing uses an ephemeral X25519 key per side and the QR code's 16-byte token `t` ([protocol.md](protocol.md)). With `A` the device showing the code and `B` the scanner:

```
z      = X25519(e_A, e_B)                                   reject all zeros
K_ab   = Derive(z, t, "pair a2b", e_A_pub ‖ e_B_pub, 32)
K_ba   = Derive(z, t, "pair b2a", e_A_pub ‖ e_B_pub, 32)
SAS    = Derive(z, t, "sas", e_A_pub ‖ e_B_pub, 4)  as a big-endian integer, top bit cleared, mod 1 000 000
```

The SAS is shown as six digits with leading zeros. Messages from A to B are boxes under `K_ab` and from B to A under `K_ba`, with `aad = "FLOW-SYNC/2 pair" ‖ t ‖ u64(seq)`. Because both keys depend on `t`, only someone who read the QR code can produce a box the other side accepts.

## Recovery key

```
r        = 32 bytes from the CSPRNG
words    = BIP-39 English mnemonic of r (24 words)
sig seed = Derive(r, "", "recovery sig", "", 32)
kem sk   = Derive(r, "", "recovery kem", "", 32)
```

The QR code holds the same 24 words separated by single spaces. Devices refuse any other number of words, including a valid shorter BIP-39 phrase. Devices store only the recovery member's public keys.

## Choices and alternatives

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Group key management | Signed roster with epoch keys wrapped by HPKE | **MLS** ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)): deletes keys after use and gives new members no history ([RFC 9750 §6](https://www.rfc-editor.org/rfc/rfc9750)), needs a delivery service that orders one commit per epoch (WebDAV and S3 can't), treats a recovery key as a long-offline member, and costs an estimated 1 to 2.5 MB per Android ABI. Borrowed from MLS: labelled derivation, purpose keys, the epoch commitment, group context in every AAD, and a suite byte. |
| Bulk encryption | AES-256-GCM with a derived key per box and a commitment | **Plain AES-GCM with random nonces**: a 2<sup>32</sup> cap per key that devices can't coordinate. **XChaCha20-Poly1305**: no RFC (the draft expired in 2020) and no Android API. **AES-GCM-SIV**: Android API 30+ only, and the Rust crate has never been audited. |
| HPKE AEAD | AES-256-GCM | ChaCha20-Poly1305 needs Android API 28. |
| Android library | Conscrypt 2.6.1, already in the APK, for HPKE; BouncyCastle for Ed25519 and X25519. With the BIP39 word list they add 14.7 KB to the FOSS APK after R8. | **Conscrypt alone**: its public API can't derive an Ed25519 public key from a seed, which recovery keys need. Tink, libsodium and a newer standalone Conscrypt cost 0.5 to 5 MB. |
| Signature verification on the server | `@noble/curves`, strict mode | WebCrypto Ed25519 differs between runtimes in edge cases. |
