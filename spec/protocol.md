# Protocol

This document covers who belongs to a group (the roster), how keys change (epochs), how devices join, leave and recover, and how data moves. The byte formats are in [store.md](store.md) and the algorithms in [crypto.md](crypto.md).

## Roster

The roster is an append-only, hash-chained log of signed entries. Every device verifies the whole chain from genesis and is its own root of trust. The server verifies entries too, but nothing it does can add a member.

### Entry

An entry is a canonical JSON object:

| Field | Type | Present | Meaning |
|---|---|---|---|
| `v` | int | always | `2` |
| `group` | hex | always | The 16-byte group id |
| `seq` | int | always | 0 for genesis, then +1 per entry |
| `prev` | hex | always | SHA-256 of the previous entry; 32 zero bytes for genesis |
| `op` | string | always | `genesis`, `add`, `remove`, `leave`, `rotate`, `rename`, `restore` or `recovery` |
| `signer` | hex | always | The signing member's `did` |
| `add` | array | when adding | Subjects `{"did", "sig", "kem", "role"}`, sorted by `did`; `sig` and `kem` are b64 public keys; `role` is `device` or `recovery` |
| `remove` | array | when removing | Hex `did`s, sorted |
| `epoch` | object | when starting an epoch | `{"n": e, "kc": b64(kc_e), "to": [did, …]}`, with `to` sorted |
| `meta` | object | optional | `did → b64(Box(P_e,roster, "FLOW-SYNC/2 meta" ‖ group ‖ u64(seq) ‖ did, payload))`, where the payload content is canonical JSON `{"app", "name", "platform"}`, and `e` is the epoch in force after this entry |
| `sigs` | object | always | `did → b64(signature)` |

Absent fields are omitted, never `null` or empty.

- **Signatures** cover `"FLOW-SYNC/2 roster" ‖ canonical(entry without "sigs")`.
- **Entry hash** is `SHA-256(canonical(entry))`, including `sigs`. The next entry's `prev` is this hash.
- **`app`** in `meta` is the installation's FLOW-SYNC/1 `deviceId`, so both protocols can show the same device.

### Validation

A device keeps the roster state: the last `seq` and hash, the current epoch `n` and `kc`, and the members (`did`, keys, role, and for the recovery member whether it has been used), and whether a device has left since the current epoch started, so a `rotate` is due. An entry is valid against that state when all of these hold:

1. `v` is 2, `group` matches, `seq` is the last `seq` + 1, and `prev` is the last hash. Genesis has `seq` 0 on an empty state.
2. `signer` is a current member, and `sigs[signer]` verifies under its key.
3. Every subject in `add` has `did = Hash("device", sig ‖ kem)[0..16]`, a valid Ed25519 public key ([crypto.md](crypto.md#ed25519-checks)), a `did` never seen before in this roster, and a valid `sigs[did]`. That reverse signature proves the subject agreed to join.
4. The `op` rules hold:

| `op` | Signer | Must contain | Must not contain | Effect |
|---|---|---|---|---|
| `genesis` | the device in `add` | `add`: one `device`, one `recovery`; `epoch` with `n` 0 | `remove` | Creates the group |
| `add` | a device | `add`: one `device` | `remove`, `epoch` | Adds a device |
| `remove` | a device | `remove`: one or more devices, not the signer; `epoch` | `add` | Removes devices and starts an epoch |
| `leave` | a device, not the last one | `remove`: exactly the signer | `add`, `epoch` | The signer stops being a member ([Leaving](#leaving)) |
| `rotate` | a device | `epoch` | `add`, `remove` | Starts an epoch for the current members |
| `rename` | a device | `meta` for exactly one current device | `add`, `remove`, `epoch` | Changes a name |
| `restore` | the recovery member, not used yet | `add`: one `device`; `epoch` | `remove` | Adds a device, starts an epoch, marks the recovery member used |
| `recovery` | a device | `remove`: the current recovery member; `add`: one `recovery`; `epoch` | | Replaces the recovery key and starts an epoch |

5. When `epoch` is present, `n` is the current epoch + 1 (0 for genesis), and `to` is exactly the set of members after the entry.
6. `meta` keys are members after the entry.

A device can use epoch `e` only after unwrapping `K_e` from its own wrap and checking it against `kc`. A recovery member that has signed a `restore` can never sign again. The restored device MUST replace it with a `recovery` entry right away, which shows the user new words.

### Forks

The Flow server appends linearly: an append names the current head and fails if another append got there first.

WebDAV, S3 and LAN peers can't do that, so two devices may append at the same `seq`. Entries are stored under names that include their hash, so both survive, and every device picks the same winner:

1. Only entries valid against the state before them count.
2. Lowest rank wins: `remove` 0, `leave` 1, `recovery` 2, `restore` 3, `rotate` 4, `add` 5, `rename` 6. Removal wins so a revoked device can't win with a concurrent entry. `leave` comes next, so an entry that starts an epoch at the same `seq` is re-applied on top of it and leaves the departed device out. `rotate` comes after the other entries that start an epoch, because any of them makes it unnecessary.
3. For equal rank, the lowest entry hash (as bytes) wins.

Losing entries, and everything built on them, are ignored. A device whose entry lost re-applies its change on top of the winner.

A device MUST NOT seal anything under an epoch its own entry started until it has re-read that `seq` from the store and found its entry still winning. Other devices adopt an epoch only once they see the winning entry.

## Pairing

Pairing joins a new device N to the group through a member M. Whichever device has a camera scans; the other shows the QR code.

### QR code

Canonical JSON, at most 512 bytes:

```
{"v":2,"t":b64(16 random bytes),"e":b64(ephemeral X25519 public key),
 "r":"m" or "n", "d":"device name", "s":{store}, "l":[{"a":"192.168.1.20","p":49210}]}
```

- `r` is the role of the device showing the code: `m` member, `n` new.
- `s` is shown only by a member: `{"k":"server","u":"https://…"}`, `{"k":"webdav","u":"https://…/flow-sync/"}`, `{"k":"s3","u":endpoint,"b":bucket,"g":region,"x":prefix}` or `{"k":"lan"}`. It never contains credentials.
- `l` lists LAN addresses where the shower listens, using the same address rules as FLOW-SYNC/1. A new device always lists them, because it knows no store yet.

FLOW-SYNC/1 apps reject `v:2` and ask the user to update. FLOW-SYNC/2 apps still accept `v:1` codes.

### Channel

The scanner reaches the shower over the LAN when an `l` address answers. Otherwise, when the shower is a member, it uses the store's pairing mailbox ([store.md](store.md#pairing-mailbox)). On a Flow server the mailbox needs no credentials. On WebDAV and S3 it does, so the scanner uses it only when the user entered that store's credentials before scanning; otherwise both devices must be on the same LAN. Both sides derive `K_ab`, `K_ba` and the SAS ([crypto.md](crypto.md#pairing)). Every message is a box, numbered from 0 in each direction. The scanner's first message starts with its ephemeral X25519 public key (32 bytes), in the clear, followed by the box: the shower needs that key to derive the keys that open it.

The scanner first sends its ephemeral X25519 public key (32 bytes) in the clear, because the shower needs it to derive the keys:

- **LAN:** the scanner tries the `l` addresses in order, each with a 3-second connect timeout, and opens a WebSocket to `ws://<a>:<p>/flow-sync/2/pair`. Its first binary frame is the key; every later frame, in both directions, is one message. The shower serves one scanner at a time, and drops a connection as soon as a box from it fails to open.
- **Mailbox:** the key is the prefix of the scanner's first message.

The shower keeps the slot open for 180 seconds and then closes it, as in FLOW-SYNC/1. Neither side compares clocks.

### Messages

Each message is canonical JSON with a `type`, carried as a payload in a box.

| # | From | `type` | Content |
|---|---|---|---|
| 1 | N | `join` | N's `sig` and `kem` public keys, fresh for this group ([crypto.md](crypto.md#device-keys)), and its `meta` content |
| | both | | Both devices show the SAS. Each user confirms on their device. A device that hasn't confirmed sends nothing more. |
| 2 | M | `entry` | The `add` entry for N, signed by M except for `sigs[N]` |
| 3 | N | `accept` | N's signature over that entry |
| | M | | M appends the completed entry and N's wrap to the store |
| 4 | M | `welcome` | `group`, `head` and `seq` (the roster head after the `add`), `link` (the link id of the member's active profile if it syncs, otherwise of the first profile it syncs; the new device's Default profile joins it), and `store`: for a Flow server `{"k":"server","u":url,"i":instance}`, for WebDAV `{"k":"webdav","u":url,"n":user,"w":password}`, for S3 `{"k":"s3","u":endpoint,"b":bucket,"g":region,"x":prefix,"y":"path" or "host","a":access key id,"s":secret}` (credentials travel only inside the pairing boxes and are stored in the platform keystore), for a [LAN group](live.md#lan-groups) `{"k":"lan"}`, with `entries` and `wrap` next to it |
| 5 | N | `done` | N has verified the roster from genesis to that head, unwrapped `K_e` and checked `kc` |

Over the LAN, `join` and `welcome` also carry `p`, the port of the sender's [LAN service](live.md#discovery). Each device remembers the other's address on the pairing connection with that `p`, so they can meet again where mDNS doesn't reach.

N pins the head from `welcome`. A store that later shows N a different history at or below that `seq` is treated as a fork.

### Joining with the admin token

On a Flow server, a new device can ask to join instead of scanning a code ([api.md](api.md)):

1. The new device posts a join request with the admin token: a random 16-byte `id` (hex) and its device name, at most 64 characters. A request lasts 180 seconds, and at most 3 are pending.
2. Linked devices list pending requests while Linked devices is open and on each sync, and ask the user: "*name* wants to join".
3. A member that accepts makes an offer exactly as for a QR code, posts the code to the request, and waits as the shower through the pairing mailbox. A member that declines marks the request declined; it then no longer counts toward the 3 pending.
4. The new device polls its request with the admin token until the code arrives, then pairs as the scanner of that code. If a member declined, the poll answers `declined` until the request would have expired, and the new device stops and tells the user. A request that expires unanswered reads as unknown.

The six-digit check still decides. The name in a request is unauthenticated, and a server that swaps codes makes the two devices show different digits.

## Removal

Any remaining device can remove one or more devices, including one that is lost:

1. Generate `K_(e+1)`. Write a wrap for each remaining member, including the recovery member, and the history chain box.
2. Append a `remove` entry with `epoch` `n = e + 1`, `kc` and `to`.
3. The server revokes the removed devices' tokens on that append. On WebDAV and S3, the user should also revoke the removed device's credentials if it had its own.
4. Soon after, write a new snapshot under `e + 1` for each link it can ([Snapshots](#snapshots)), so new devices don't depend on older epochs.

Old objects are not re-encrypted: the removed device already had them. They leave through garbage collection.

A device that finds itself missing from a roster it has verified deletes its device keys and the group's epoch keys, and stops syncing. On a Flow server it can no longer read the roster: once the server refuses it a token, it stops syncing and tells the user, who can forget the group, which deletes the same keys.

## Leaving

A device can't sign its own `remove`, and must never hold the key of the epoch that shuts it out. So it leaves with an entry that changes no keys, and the devices that stay start the next epoch:

1. The leaving device appends a `leave` entry signed by itself, with only its own `did` in `remove`. The last device of a group can't leave; it can only forget the group.
2. The server revokes its tokens on that append. The device then deletes its device keys, the group's epoch keys and everything it stored for the group. On WebDAV and S3, the user should also revoke its credentials if it had its own.
3. A device that sees a `leave` not yet followed by an entry that starts an epoch appends a `rotate` before it writes any new object: it generates `K_(e+1)`, writes a wrap for each current member, including the recovery member, and the history chain box, and appends `rotate` with `epoch` `n = e + 1`. Devices that rotate at the same time make a fork, resolved as above; a device whose `rotate` lost adopts the winner's epoch and doesn't rotate again.
4. The device that rotated writes new snapshots under `e + 1` soon after, as after a removal.

From its `leave` on, the device counts as removed everywhere in this document: its acks no longer hold back garbage collection, and any current device may delete its objects. To join again it pairs with new device keys, so it gets a new `did` and a new log.

## Recovery

Setup shows the recovery key once, as 24 words and a QR code, and asks for two of the words back before it counts the key as saved. Until then, Linked devices shows that the key isn't confirmed.

To restore onto a new device, the user enters the words and the store location (and WebDAV or S3 credentials). The device:

1. Derives the recovery keys and reads and verifies the roster.
2. Unwraps the latest `K_e` from the recovery member's wrap and checks `kc`.
3. Creates fresh device keys, writes wraps of `K_(e+1)`, and appends a `restore` entry signed by the recovery key.
4. Immediately creates a new recovery key, appends a `recovery` entry, and shows the new words.
5. Reads every log, then links its Default profile like a `welcome` would. When change batches and snapshot manifests name one link for profile data, it joins that link; when they name none, it starts a link with its own profile id; when they name several, the user picks one from the `profiles` records, or starts a new link. It writes no batch before that.

Every other device shows that the group was restored with the recovery key, and when.

Any device can append a `recovery` entry at any time, for example after losing the words. The old recovery member stops receiving epoch keys.

## Sync

### Streams

Each device writes one log: a sequence of objects numbered from 1, each naming the SHA-256 of its predecessor ([store.md](store.md#envelope)). The log holds change batches, snapshot manifests and acknowledgements. Live messages use a separate counter ([live.md](live.md)).

A reader keeps, per sender, the last `seq` and hash it verified:

- The next object must have `seq` + 1 and the matching `prev`.
- An object at or below the last `seq` is a replay and is ignored. If its bytes differ from what was verified, the store is misbehaving and the device warns.
- A gap means the store is withholding, or hasn't caught up. The reader waits; it doesn't skip.
- A device that has never read a sender starts at its first object (`seq` 1, `prev` all zeros), or right after the sender's entry in the version vector of the snapshot it bootstraps from ([several links](#reading-a-link-from-its-snapshot)). A store therefore can't hide the beginning of a log.

A device that sees the roster head, or any sender's `seq`, go backwards stops writing and warns that the store rolled back.

### Change batches

Each batch carries the records of one collection for one link, as a header line followed by canonical records, one per line, exactly as FLOW-SYNC/1 §7 and §10 define them:

```
{"collection":"watch_history","head":"<roster head hex>","link":"<link id>"}
{…record…}
{…record…}
```

- `collection` is a FLOW-SYNC/1 collection id, or `profiles`.
- `link` is the profile link id, or `null` for `profiles`.
- `head` is the sender's roster head when it wrote the batch. Two batches naming different heads for the same roster `seq` reveal a fork.

Batches are deltas: records changed since the device's previous batch for that collection and link, taken from the apps' change ledgers. A receiver merges them with the existing FLOW-SYNC/1 merge rules, in one local transaction per batch, and skips collections it doesn't know (Desktop has no `notes`).

Clocks are hybrid logical clocks: a device persists the highest physical time of any stamp it has applied, and stamps a local edit with at least that time plus one millisecond, so an edit made after reading another device's change wins over it even when this device's clock is behind. Devices warn when their clock differs from the store's `Date` by more than 2 minutes, because last-writer-wins still follows device clocks.

Group members go beyond FLOW-SYNC/1, on every transport: a `subscriptions` record carries `members`, `[{"channelId","hlc","deleted"}]` sorted by `channelId`, next to `channelIds`. Members merge like playlist items: last writer wins per channel, and removing a channel leaves a tombstone. `members` is left out when a group has none. `channelIds` stays the list of live members for apps that don't know `members`, and a record without `members` counts each of its `channelIds` as present at the record's `hlc`.

`flow_neuro_brain` SHOULD be sent at most once every 6 hours.

### Profiles

Each synced profile has a *link id*: the UUID of the profile that first published it. The `profiles` collection holds `{"link", "name", "hlc", "deleted"}` records, merged last-writer-wins by `hlc`.

A device writes a `profiles` record for each link it syncs that has none, and a new one when the user renames a linked profile. An empty `name` is a default profile that was never renamed, and apps show their own name for it.

Each device keeps its own map from local profile to link id; a link maps to at most one local profile. Profiles that aren't linked never leave the device. A device in a group keeps at least one profile linked.

- **Linking.** A local profile either starts a link with its own id, or joins a link listed in `profiles`, and its local data then merges with the link's. A device can also create a local profile for a link it doesn't sync yet. A profile that joins a link [reads it from its snapshot](#reading-a-link-from-its-snapshot) before it sends batches for that link.
- **Inactive profiles.** Both apps run one profile at a time. Batches for a linked profile that isn't active are kept on the device and count as consumed. When that profile becomes active, the device applies them in the order it read them, one transaction per batch, before it sends anything for that link.
- **Unlinking.** A device that stops syncing a profile removes it from its map and keeps its local data. It skips that link's later batches.
- **Deleting.** A record with `deleted: true` retires the link for every device: each unlinks its profile and keeps the local data. Its batches no longer hold back [garbage collection](#garbage-collection), so a profile linked to it again starts from what the store still holds. A device that a delete leaves with no linked profile adds no devices until the user links one.

### Snapshots

A snapshot holds the merged state of one link (or of `profiles`) as blobs, plus a manifest in the writer's log:

```
{"head":"<roster head>","link":"<link id>|null","parts":[{"blob":"<hex>","collection":"…","size":n}],"vv":{"<did>":{"hash":"<hex>","seq":n}}}
```

`vv` is the version vector the state includes: for each sender, the last `seq` merged and the SHA-256 of that object. Merges are state-based, so any device's snapshot is valid, and a new device can start from any snapshot and then read each log after `vv`. The first object it reads from sender X must have `seq` = `vv[X].seq` + 1 and `prev` = `vv[X].hash`, so the chain still holds once older objects are deleted.

A device writes snapshots only of `profiles` and of the link of its active profile, once every batch it keeps for that link is applied; its state then includes everything its `vv` names. It SHOULD write one when it has merged more than 1 MiB of batches since the last snapshot of that link, when the last one is 7 days old, and after starting an epoch with `remove` or `rotate`.

#### Reading a link from its snapshot

A device starts reading a link when it bootstraps, and when it links a profile to a link it hasn't been reading. It takes the newest snapshot of that link it can open, then reads each sender's log from that snapshot's `vv` and applies only that link's batches, up to where it had already read. A link with no snapshot is read from each log's first object. Bootstrapping several links at once, a device reads each log from the lowest `vv` entry among their snapshots and skips a link's batches that its own snapshot already includes. [Garbage collection](#garbage-collection) keeps every object that a link's snapshots don't cover, so these are still in the store.

### Acknowledgements

After applying, a device appends an ack: `{"vv":{"<did>":seq}}`, the last `seq` of every other sender it has consumed. A batch skipped on purpose (a link the device doesn't sync), or kept for a profile that isn't active, counts as consumed. A device has always read its own log, so its acks leave itself out. Acks aren't acknowledged: a device writes one only after consuming batches or snapshot manifests, and its next ack covers any acks it read before.

### Garbage collection

An object of sender X at `seq` n MAY be deleted when:

- every current device other than X has a latest ack with `vv[X] ≥ n`, and
- for every link that batches name, except links whose `profiles` record is deleted, and for `profiles` once a device writes it, a snapshot that every current device has acked has `vv[X].seq ≥ n`. A device has acked a snapshot when its latest ack covers the manifest's `seq` in its writer's log.

A snapshot manifest and its blobs MAY be deleted when a newer snapshot of the same link has a version vector at least as large for every sender, every current device has acked that newer snapshot, and every current device's latest ack has `vv[X] ≥ n` for the manifest's own `seq` n, so no reader meets the gap it leaves. Removed devices don't count.

Garbage collection is done by devices, on every backend: each device deletes only its own objects, and any current device may delete the objects of a removed device. The server can't read acks, so it never decides on its own what to delete.
