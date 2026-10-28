# Store format

Every backend holds the same objects under the same names: the Flow server, WebDAV, S3-compatible storage and LAN peers. A store is untrusted. Every object verifies itself, so a torn, truncated, swapped or replayed object is detected by the reader, never trusted.

## Layout

Paths are relative to a configurable root. Names use only lowercase `[0-9a-f._/-]`, so they survive case-insensitive stores (Koofr) and Windows-safe name rules (Nextcloud 31 and later).

```
store.json                                     {"format":"FLOW-SYNC/2","group":"<hex>"}
roster/<seq:16>-<hash:16>.r                    roster entry, canonical JSON
keys/<epoch:8>/<did:32>.k                      HPKE wrap of K_e for one member, 80 bytes
keys/<epoch:8>/chain.k                         history chain box (epoch > 0)
dev/<did:32>/log/<shard:16>/<seq:16>.o         log object (envelope), shard = seq >> 10
dev/<did:32>/blob/<sha256:64>.b                snapshot blob
pair/<slot:32>/<dir>-<seq:16>.p                pairing mailbox message, dir is a or b
probe/<random:32>                              setup probe, deleted right after
```

`<x:n>` is `x` in lowercase hex, zero-padded to `n` digits. `<hash:16>` is the first 8 bytes of the entry hash; `<slot:32>` is `Hash("pair", t)[0..16]`.

### Writing rules

- **One writer per path.** Only device `did` writes under `dev/<did>/`. A roster entry or wrap is written by the device that creates it. Nothing is ever overwritten.
- **Wraps before entries.** A device writes every wrap (and `chain.k`) for a new epoch before the roster entry that starts it. An entry whose wraps are missing is not usable yet; readers retry later.
- **Size.** An object is at most 4 MiB (4,194,304 bytes). Snapshot blobs SHOULD hold at most 2 MiB of payload. This stays below S3 multipart, Nextcloud chunked upload, and serverless body limits.
- **Deleting.** Only garbage collection deletes ([protocol.md](protocol.md#garbage-collection)), and on WebDAV, S3 and LAN peers a device deletes only its own paths.

## Envelope

Log objects (change batches, snapshot manifests, acks) and live messages share one envelope:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `"FS2"` 0x00 |
| 4 | 1 | type |
| 5 | 1 | suite, `0x01` ([crypto.md](crypto.md#suite-1)) |
| 6 | 16 | group id |
| 22 | 4 | epoch |
| 26 | 16 | sender `did` |
| 42 | 8 | seq |
| 50 | 32 | prev: SHA-256 of the sender's previous log object, zeros for the first, and always zeros for live messages |
| 82 | | box: `Box(P_e,x, header, payload)`, with the 82-byte header as associated data |
| end − 64 | 64 | Ed25519 signature over `"FLOW-SYNC/2 object" ‖ header ‖ box` |

| Type | Content | Purpose key `x` |
|---|---|---|
| `0x01` | Change batch | `changes` |
| `0x02` | Snapshot manifest | `snapshot` |
| `0x03` | Acknowledgement | `ack` |
| `0x10` | Live message | `live` |

The smallest valid envelope is 482 bytes: a 256-byte payload inside a box.

### Reading an envelope

A reader MUST, in this order:

1. Check the length (482 bytes to 4 MiB), the magic, a supported suite, and the group id.
2. Find the sender in the roster as a member while `epoch` was in force. Objects written before a device's removal stay valid.
3. Verify the signature with the sender's key. Signatures are checked before anything is decrypted.
4. Check `seq` and `prev` against the sender's stream ([protocol.md](protocol.md#streams)), or the live counter for live messages.
5. Open the box with `P_e,x` for the type, and decode the payload.

A failure at any step discards the object. It is never partly applied.

## Snapshot blobs

```
blob = Box(P_e,snapshot, "FLOW-SYNC/2 blob" ‖ group ‖ u32(e) ‖ did, payload)
name = hex(SHA-256(blob))
```

`e` and `did` are the epoch and sender of the manifest that lists the blob. The blob isn't signed: the signed manifest names its hash, so the reader checks the hash first. Blob content uses the change batch format: a header line, then records.

## Pairing mailbox

When pairing through a store, the member opens a slot and each side writes its messages ([protocol.md](protocol.md#pairing)) to `pair/<slot>/<dir>-<seq>.p` (`a` from the code's shower, `b` from the scanner). Each file is one box. The member deletes the slot when pairing ends or its 180 seconds run out. On the Flow server the mailbox is an API ([api.md](api.md)) with the same messages.

## Backends

### Flow server

The server stores this layout behind its API, indexes objects by sender and `seq`, and offers one cursor over all new objects. It linearizes roster appends, so roster forks can't happen there.

### S3-compatible

- Objects are plain `PutObject` and `GetObject` calls with `Content-Type: application/octet-stream`.
- To find new objects, a device HEADs the sender's next `seq`; `HEAD` is cheaper than `LIST` on AWS and R2. To catch up, it uses `ListObjectsV2` with `prefix` and `start-after`.
- Signing is AWS SigV4. Android signs requests itself on OkHttp, because the AWS SDK and minio-java don't fit the APK budget. That code MUST pass AWS's published SigV4 test suite.

### WebDAV

- `PUT`, `GET`, `MKCOL` and `PROPFIND`, with `Depth` always sent explicitly (`0` or `1`). A request without `Depth` means infinity.
- To find new objects, a device GETs the sender's next `seq` until a 404, and uses `PROPFIND Depth: 1` only on the current shard. On Nextcloud, a `Depth: 0` request for a folder's ETag shows whether anything inside changed, so devices with no changes can be skipped.
- A 401 stops all requests until the user fixes the credentials: Nextcloud blocks an IP for 30 minutes after 10 failures. Devices SHOULD use Nextcloud Login Flow v2 to get their own app password.

### Setup probe

Conditional writes are not reliable across backends. B2 rejects `If-None-Match: *`, Garage accepts and ignores it, WebDAV servers check before writing, and rclone's WebDAV server ignores it. When a backend is added, the device writes `probe/<random>` twice with `If-None-Match: *`:

- 412 on the second write: the header works, and the device sends it on later writes as an extra guard.
- 501, or 200 again: the device doesn't send it.

Correctness never depends on the result.

### Transport security

- Every backend is reached over HTTPS, except an address that is private: [RFC 1918](https://www.rfc-editor.org/rfc/rfc1918), `100.64.0.0/10` ([RFC 6598](https://www.rfc-editor.org/rfc/rfc6598), including Tailscale), `fc00::/7` ([RFC 4193](https://www.rfc-editor.org/rfc/rfc4193)), link-local or loopback, or a `.local` name. Those are allowed over HTTP with a warning.
- The check applies to every address the name resolves to, after unwrapping IPv4-mapped IPv6, and to the address actually connected to. HTTP redirects are refused.
- Credentials for WebDAV and S3 are kept in the platform keystore or keychain, never in settings, backups or sync.
