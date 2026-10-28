# Live channel and LAN transport

## Live messages

Live messages carry handoff, remote control and presence between a group's devices. Each is an envelope of type `0x10` ([store.md](store.md#envelope)), sealed under `P_e,live` and signed by its sender. Its `seq` is the sender's live counter, which the sender MUST persist so it never repeats. `prev` is zero. A receiver accepts a sender's message only if its counter is above the highest it has accepted from that sender.

The payload content is canonical JSON:

| `type` | Fields | Meaning |
|---|---|---|
| `presence` | `can`: list of `play`, `remote` | The sender is online and what it accepts |
| `now` | `video`, `title`, `pos` (ms), `dur` (ms), `state` (`playing` or `paused`), `vol` (0 to 100), `queue` (video ids, at most 50) | What the sender is playing |
| `play` | `to`, `video`, `pos` (ms), `music` (bool), `link` (link id or `null`) | Ask device `to` to play a video from a position, in the linked profile |
| `cmd` | `to`, `cmd` (`play`, `pause`, `seek`, `next`, `previous`, `volume`, `queue`), and `pos`, `vol` or `queue` as the command needs | Control playback on device `to` |
| `result` | `to`, `ref` (the counter of the message answered), `ok` (bool), `reason` | The outcome of `play` or `cmd` |

`to` is inside the ciphertext. Every message goes to every connected device of the group, so the relay doesn't learn who controls whom. A device ignores `play`, `cmd` and `result` messages not addressed to it.

### Consent

The first `play` or `cmd` from a device asks the user on the receiving device: allow always, allow once, or decline. The answer is remembered per sending device and can be changed under Linked devices. A declined request gets a `result` with `ok: false` and `reason: "declined"`.

### Server relay

`GET /v1/live` upgrades to a WebSocket. The token travels as a subprotocol, `Sec-WebSocket-Protocol: flow-sync.v1, bearer.<token>`, and the server answers `flow-sync.v1`.

- Binary frames are envelopes. The server checks the length (at most 64 KiB), the group, that the sender is the token's device, and the signature. It then forwards the frame to the group's other connections and keeps nothing.
- Text frames come only from the server: `{"type":"peers","online":["<did>", …]}` whenever the set of connected devices changes.
- Clients ping every 15 seconds. The server checks its connections at least every 15 seconds and closes any whose token has expired or whose device was removed. Clients reconnect with a fresh token.
- Per device: at most 20 messages per second and 2 connections.

Docker, the container hosts and Cloudflare Workers (through one Durable Object per instance using the WebSocket Hibernation API) carry the live channel. On Vercel and Netlify, `/v1/info` reports `"live": false`, and apps hide handoff and remote control there unless the devices share a LAN.

## LAN transport

Linked devices on the same network sync and exchange live messages directly, with no server and no QR code.

### Discovery

Devices advertise `_flow._tcp` over mDNS ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762), [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763)):

- Instance name: `Flow-` followed by 4 random hex digits, new each time the app starts. Never the device name.
- TXT records: `v=2` and `t=<hex>`, where `t = Derive(P_e,lan, "", "lan tag", u64(floor(unix seconds / 3600)), 8)`.

Members compute the tags for the previous, current and next hour and connect only to matching services. Anyone else on the network sees only that a Flow device is present.

### Session

The connecting device C opens a WebSocket to `ws://<address>:<port>/flow-sync/2` on the advertising device S. Every frame is `u32(e) ‖ box`, with `e` the epoch whose `P_e,lan` seals the first three messages:

| # | From | Box content |
|---|---|---|
| 1 | C | `{"did": C, "n": b64(32 random bytes)}` |
| 2 | S | `{"did": S, "n": b64(32 random bytes), "sig": b64(sign_S("FLOW-SYNC/2 lan server" ‖ n_C ‖ n_S ‖ C ‖ S))}` |
| 3 | C | `{"sig": b64(sign_C("FLOW-SYNC/2 lan client" ‖ n_C ‖ n_S ‖ C ‖ S))}` |

Messages 1 to 3 use `aad = "FLOW-SYNC/2 lan hello" ‖ u8(#)`. Each side checks that the other is a current device and that its signature verifies. Only members hold `P_e,lan`, so outsiders can't even complete message 1. After message 3:

```
K_cs = Derive(P_e,lan, n_C ‖ n_S, "lan c2s", C ‖ S, 32)
K_sc = Derive(P_e,lan, n_C ‖ n_S, "lan s2c", C ‖ S, 32)
```

Later frames are `u64(seq) ‖ Box(K, "FLOW-SYNC/2 lan" ‖ u64(seq), payload)`, with `seq` counting from 0 in each direction and checked strictly.

### Requests

Each request and response is a payload whose content is a JSON header line, then `\n`, then raw bytes when the operation carries an object:

| `op` | Request | Response |
|---|---|---|
| `roster` | `after` | Entries after that `seq` |
| `key` | `epoch`, `did` | The wrap, or the chain box when `did` is `chain` |
| `list` | `vv`: `{did: seq}` | Paths of log objects above `vv` that the peer holds, and blob names they reference |
| `get` | `path` | The object |
| `put` | `path`, then the object | `ok` |
| `live` | the live envelope | none |

A peer serves the objects it holds, its own and the ones it has fetched, and accepts any object that verifies ([store.md](store.md#reading-an-envelope)). LAN-only groups therefore converge through any device that meets the others.

### Platform notes

- Android: `NsdManager`. Take a `MulticastLock` on API 31 and below. Request `ACCESS_LOCAL_NETWORK` when targeting SDK 37.
- Desktop: `mdns-sd` 0.21.6 or later with one daemon per process. On macOS, declare `NSLocalNetworkUsageDescription`; on Windows, the installer adds a firewall rule.
