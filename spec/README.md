# FLOW-SYNC/2 specification

Status: **draft, in review.** Nothing here is frozen until the maintainer approves Phase 0.

FLOW-SYNC/2 links one person's Flow devices into a sync group. Devices exchange end-to-end encrypted objects through a store: a Flow server, WebDAV, S3-compatible storage, or each other on the LAN. No store can read, forge or silently reorder what devices write.

| Document | Contents |
|---|---|
| [threat-model.md](threat-model.md) | Assets, adversaries, goals, the mechanism behind each goal, and its limits |
| [crypto.md](crypto.md) | Primitives, labels, key schedule, sealing, padding, and why each was chosen |
| [protocol.md](protocol.md) | Device identity, the roster, epochs, pairing, removal, recovery, sync rules |
| [store.md](store.md) | The encrypted object envelope and the layout every backend shares |
| [api.md](api.md) | The Flow server's HTTP API v1 and its limits |
| [live.md](live.md) | The live channel (handoff, remote control, presence) and the LAN transport |
| [vectors/](vectors/) | Test vectors every implementation must pass |

## Conventions

- The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when in capitals.
- `‖` is byte concatenation. `u8`, `u32`, `u64` are unsigned big-endian integers of 1, 4 and 8 bytes.
- Labels are ASCII strings with no terminator, for example `"FLOW-SYNC/2 seal"`.
- `hex` is lowercase hexadecimal. `b64` is base64url without padding ([RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5)), as in FLOW-SYNC/1.
- Canonical JSON is the FLOW-SYNC/1 form: no whitespace, object keys sorted by Unicode code point, standard string escaping, integers only (no floats, no exponents). For the values used here it equals [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
- A *device* is one Flow installation. A *member* is a device or the recovery key in the roster. The *group* is the set of members.

## Versioning

- The protocol name is `FLOW-SYNC/2`. It appears in every label, so keys and signatures can never be confused with FLOW-SYNC/1 or a later version.
- The object envelope carries a suite byte (see [crypto.md](crypto.md)); a new suite, for example a post-quantum KEM, is added without changing the layout.
- The server API is versioned by path (`/v1`). `GET /v1/info` lists supported versions.
- FLOW-SYNC/1 (one-time QR sync) is unchanged and remains supported by both apps.

## Reference implementation

`packages/protocol/` is the reference. Where the reference and this text disagree, the disagreement is a bug: report it, and the vectors decide until it is fixed.
