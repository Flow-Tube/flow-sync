# Live channel and LAN transport

## Live messages

Live messages carry handoff, remote control and presence between a group's devices. Each is an envelope of type `0x10` ([store.md](store.md#envelope)), sealed under `P_e,live` and signed by its sender. Its `seq` is the sender's live counter, which the sender MUST persist so it never repeats. `prev` is zero. A receiver accepts a sender's message only if its counter is above the highest it has accepted from that sender.

The payload content is canonical JSON:

| `type` | Fields | Meaning |
|---|---|---|
| `presence` | `can`: list of `play`, `remote`; `kind`: `phone`, `tablet`, `tv` or `desktop` | The sender is online, what it accepts, and which icon shows it |
| `now` | `video`, `title`, `by` (channel or artist), `music` (bool), `link` (link id or `null`), `pos` (ms), `dur` (ms), `state` (`playing` or `paused`), `vol` (0 to 100), `queue` (video ids, at most 50), `index` (the video's place in `queue`) | What the sender is playing; `video` is `null` when nothing is loaded |
| `play` | `to`, `video`, `pos` (ms), `music` (bool), `link` (link id or `null`), `queue` (video ids, at most 50), `index`, `state` (`playing` or `paused`) | Hand the sender's session to device `to`: the same queue and place, from that position, in the linked profile, or in the active profile when the target doesn't run that link |
| `cmd` | `to`, `cmd` (`play`, `pause`, `seek`, `next`, `previous`, `volume`, `queue`), and `pos`, `vol` or `queue` as the command needs | Control playback on device `to` |
| `result` | `to`, `ref` (the counter of the message answered), `ok` (bool), `reason` | The outcome of `play` or `cmd` |

`to` is inside the ciphertext. Every message goes to every connected device of the group, so the relay doesn't learn who controls whom. A device ignores `play`, `cmd` and `result` messages not addressed to it.

### Playing on another device

Handoff works like a single active player per group, as in Spotify Connect:

- A device sends `now` when what it plays changes (video, state, queue, volume, a seek) and every 30 seconds while playing. Receivers advance `pos` from the time they received it while `state` is `playing`, so progress moves without more messages. A device that stops playing sends `now` with `video` `null` once.
- The active device is the one whose latest `now` is `playing`; when several are, the most recent wins.
- To move playback, the sender sends `play` to the target with its whole session. The target starts it and answers `result`. Only after `ok: true` does the sender pause its own player, so a failed handoff never stops the music. The target's next `now` makes it the active device on every screen.
- To pull playback to itself, a device sends `cmd` `pause` to the active device and starts the session from that device's latest `now`.
- Controls for another device are `cmd` messages; the target applies them and sends `now`.
- Devices offline from the live channel and the LAN show the last time they were seen, from the server's `/v1/status` `seen` or the last LAN session.

### Consent

The first `play` or `cmd` from a device asks the user on the receiving device: allow always, allow once, or decline. The answer is remembered per sending device and can be changed under Linked devices. A declined request gets a `result` with `ok: false` and `reason: "declined"`.

### Server relay

`GET /v1/live` upgrades to a WebSocket. The token travels as a subprotocol, `Sec-WebSocket-Protocol: flow-sync.v1, bearer.<token>`, and the server answers `flow-sync.v1`.

- Binary frames are envelopes. The server checks the length (at most 64 KiB), the group, that the sender is the token's device, and the signature. It then forwards the frame to the group's other connections and keeps nothing. A frame from an epoch before the current one isn't forwarded, and its sender stays connected: it hasn't seen the entry that started the current epoch, and `changed` makes it sync. A frame from a later epoch, or one that fails a check, closes the connection.
- Text frames come only from the server: `{"type":"peers","online":["<did>", …]}` whenever the set of connected devices changes, and `{"type":"changed"}` to every other device of the group when one stores a log object, blob or roster entry. A device that has the app open syncs soon after `changed`, so changes reach it without polling.
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

Many Wi-Fi networks drop multicast between clients, so mDNS alone isn't enough:

- A device listens on the port it used last, when that port is free.
- Each device remembers, for every member, the address and port of its last session: the ones it dialed, or the peer's address with the `p` it sent in message 1 or in [pairing](protocol.md#messages).
- When a member hasn't shown up over mDNS, a device dials its remembered address with a 3-second connect timeout: when the app starts, when the network changes, and at most once a minute while it has something to send or sync.
- A device forgets a member's address when that member leaves or is removed.

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

S answers a hello under any epoch it holds a key for, up to its own. C sends its first hello under its current epoch. When S closes the connection without answering message 2, C dials again one epoch lower, for at most 4 attempts in all. So members on two sides of a fork still meet: below the fork they hold the same key. They pull what the other holds, settle, and the next session runs at the epoch they share. C doesn't retry when it can't connect at all, or when message 2 fails a check. While they are on two sides of a fork their [discovery tags](#discovery) differ, so they meet through remembered addresses. A session at an older epoch is under that epoch's `P_e,lan`; the objects and live messages it carries keep their own sealing.

### Requests

Every box on the LAN holds a [payload](crypto.md#payload-encoding), as everywhere else. Hello bodies are `{"did":"<hex>","n":"<b64>","p":<port>}`, `{"did","n","sig"}` and `{"sig"}`, where `p` is the port C listens on.

After message 3, either device may send requests at any time, and answers may come in any order. The payload of each frame is a canonical JSON header line, then `\n` and raw bytes when the operation carries them:

- A request header has `id` (counting from 0 for each sender) and `op`, plus the fields below.
- A response header has `re` (the request's `id`) and `ok`. When `ok` is false it has `error`: `not_found`, `invalid` or `refused`.

| `op` | Request fields | Response fields | Bytes |
|---|---|---|---|
| `roster` | `after` (the `seq` of the asker's head, or -1) and `head` (its hash, absent with -1) | `entries`: every roster entry the peer holds with a `seq` above `after`, fork candidates included; every entry it holds when `head` is not on its own winning chain (it holds no entry with that hash, or that entry lost a fork) | none |
| `key` | `epoch`, `kc` (the `<kc:16>` of the [store path](store.md#layout)), `name` (a member's `did` or `chain`) | none | the wrap or the chain box |
| `list` | `vv`: `{did: seq}`, for each log the last `seq` the asker holds with none missing between it and the oldest object it holds of that log | `paths`: the log objects the peer holds above `vv`; `blobs`: every blob path the peer holds | none |
| `get` | `path` | none | the object or blob |
| `put` | `path` | none | in the request: the object |
| `live` | none | no response | in the request: the live envelope |

The content of a frame, the header line with its `\n` and bytes, is at most 4 MiB + 64 KiB (4,259,840 bytes), so a full 4 MiB object fits with its header. Its encoded frame is under 4 MiB + 256 KiB, the largest WebSocket message a device must accept. A device closes a session 3 seconds after the other side stops sending. A peer serves what it holds, its own objects and the ones it has fetched. It accepts a `put` only of an object that passes steps 1 to 3 of [reading an envelope](store.md#reading-an-envelope), at the path that object belongs at.

### LAN groups

A group can live on its devices alone, with no store: its location is `{"k":"lan"}`.

- **Creating.** A device writes the genesis entry and its wraps locally. Nothing is claimed.
- **Holding.** Every device keeps every roster entry it has seen (fork candidates under their [store names](store.md#layout)), every wrap and chain box, and every log object and blob it has fetched, and serves them with the requests above.
- **Appending.** A device writes the wraps and then the entry locally; the entry spreads as other devices pull `roster`. Concurrent entries settle by the [fork rule](protocol.md#forks): a peer whose winning chain doesn't contain the asker's head answers `roster` with everything, so both see every candidate even when they pull at the same moment.
- **Pairing.** Pairing always runs over the LAN. The member's `welcome` carries `{"k":"lan"}`, and also `entries` (every roster entry up to the head it names) and `wrap` (b64, the new device's wrap of the current epoch): the new device needs both before it can verify the roster or open a LAN session, which starts with `P_e,lan`. After `done`, the member waits up to 5 seconds for the scanner to close the pairing connection, then the devices sync as below.
- **Leaving.** A device that appends a `leave` entry meets every member it can reach, for up to 10 seconds, so they pull the entry before it forgets the group. A member it couldn't reach stays listed until another device removes it.
- **Syncing.** When two members meet, through mDNS or a remembered address, each one pulls from the other: `roster` with `after` -1, since an entry that lost can sit below its head, the wraps and chain boxes it lacks for its settled chain and for the entries that lost and [stand](protocol.md#forks), then `list` with its version vector and `get` for what it lacks. It merges what it read as from any store, and writes its own objects locally only.

Groups on a store sync the same way when their devices meet, as well as through the store. For the roster, the store's answer decides while it answers ([protocol.md](protocol.md#what-a-device-does-with-a-stores-answer)).

### Platform notes

- Android: `NsdManager`. Take a `MulticastLock` on API 31 and below. Request `ACCESS_LOCAL_NETWORK` when targeting SDK 37.
- Desktop: `mdns-sd` 0.21.6 or later with one daemon per process. On macOS, declare `NSLocalNetworkUsageDescription`; on Windows, the installer adds a firewall rule.
