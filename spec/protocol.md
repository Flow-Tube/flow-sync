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
| `op` | string | always | `genesis`, `add`, `remove`, `rename`, `restore` or `recovery` |
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

A device keeps the roster state: the last `seq` and hash, the current epoch `n` and `kc`, and the members (`did`, keys, role, and for the recovery member whether it has been used). An entry is valid against that state when all of these hold:

1. `v` is 2, `group` matches, `seq` is the last `seq` + 1, and `prev` is the last hash. Genesis has `seq` 0 on an empty state.
2. `signer` is a current member, and `sigs[signer]` verifies under its key.
3. Every subject in `add` has `did = Hash("device", sig ‖ kem)[0..16]`, a valid Ed25519 public key ([crypto.md](crypto.md#ed25519-checks)), a `did` never seen before in this roster, and a valid `sigs[did]`. That reverse signature proves the subject agreed to join.
4. The `op` rules hold:

| `op` | Signer | Must contain | Must not contain | Effect |
|---|---|---|---|---|
| `genesis` | the device in `add` | `add`: one `device`, one `recovery`; `epoch` with `n` 0 | `remove` | Creates the group |
| `add` | a device | `add`: one `device` | `remove`, `epoch` | Adds a device |
| `remove` | a device | `remove`: one or more devices, not the signer; `epoch` | `add` | Removes devices and starts an epoch |
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
2. Lowest rank wins: `remove` 0, `recovery` 1, `restore` 2, `add` 3, `rename` 4. Removal wins so a revoked device can't win with a concurrent entry.
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

The scanner reaches the shower over the LAN when an `l` address answers. Otherwise, when the shower is a member, it uses the store's pairing mailbox ([store.md](store.md#pairing-mailbox)). Both sides derive `K_ab`, `K_ba` and the SAS ([crypto.md](crypto.md#pairing)). Every message is a box, numbered from 0 in each direction.

The shower keeps the slot open for 180 seconds and then closes it, as in FLOW-SYNC/1. Neither side compares clocks.

### Messages

Each message is canonical JSON with a `type`, carried as a payload in a box.

| # | From | `type` | Content |
|---|---|---|---|
| 1 | N | `join` | N's `sig` and `kem` public keys and its `meta` content |
| | both | | Both devices show the SAS. Each user confirms on their device. A device that hasn't confirmed sends nothing more. |
| 2 | M | `entry` | The `add` entry for N, signed by M except for `sigs[N]` |
| 3 | N | `accept` | N's signature over that entry |
| | M | | M appends the completed entry and N's wrap to the store |
| 4 | M | `welcome` | Group id, store settings (including WebDAV or S3 credentials), roster head `seq` and hash |
| 5 | N | `done` | N has verified the roster from genesis to that head, unwrapped `K_e` and checked `kc` |

N pins the head from `welcome`. A store that later shows N a different history at or below that `seq` is treated as a fork.

## Removal

Any remaining device can remove one or more devices, including one that is lost:

1. Generate `K_(e+1)`. Write a wrap for each remaining member, including the recovery member, and the history chain box.
2. Append a `remove` entry with `epoch` `n = e + 1`, `kc` and `to`.
3. The server revokes the removed devices' tokens on that append. On WebDAV and S3, the user should also revoke the removed device's credentials if it had its own.
4. Write a new snapshot under `e + 1` for each link soon after, so new devices don't depend on older epochs.

Old objects are not re-encrypted: the removed device already had them. They leave through garbage collection.

## Recovery

Setup shows the recovery key once, as 24 words and a QR code, and asks for two of the words back before it counts the key as saved. Until then, Linked devices shows that the key isn't confirmed.

To restore onto a new device, the user enters the words and the store location (and WebDAV or S3 credentials). The device:

1. Derives the recovery keys and reads and verifies the roster.
2. Unwraps the latest `K_e` from the recovery member's wrap and checks `kc`.
3. Creates its own device keys, writes wraps of `K_(e+1)`, and appends a `restore` entry signed by the recovery key.
4. Immediately creates a new recovery key, appends a `recovery` entry, and shows the new words.

Every other device shows that the group was restored with the recovery key, and when.

Any device can append a `recovery` entry at any time, for example after losing the words. The old recovery member stops receiving epoch keys.

## Sync

### Streams

Each device writes one log: a sequence of objects numbered from 1, each naming the SHA-256 of its predecessor ([store.md](store.md#envelope)). The log holds change batches, snapshot manifests and acknowledgements. Live messages use a separate counter ([live.md](live.md)).

A reader keeps, per sender, the last `seq` and hash it verified:

- The next object must have `seq` + 1 and the matching `prev`.
- An object at or below the last `seq` is a replay and is ignored. If its bytes differ from what was verified, the store is misbehaving and the device warns.
- A gap means the store is withholding, or hasn't caught up. The reader waits; it doesn't skip.
- A device that has never read a sender starts at the sender's oldest available object, or at the snapshot it bootstraps from.

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

Two record rules go beyond FLOW-SYNC/1, and both apps apply them on every transport:

- **Group members.** A `subscriptions` record carries `members`, `[{"channelId","hlc","deleted"}]` sorted by `channelId`, next to `channelIds`. Members merge like playlist items: last writer wins per channel, and removing a channel leaves a tombstone. `channelIds` stays the list of live members, for apps that don't know `members`; a record without `members` counts each of its `channelIds` as present at the record's `hlc`.
- **Stamps.** Every stamp a device creates follows the clock rule above.

`flow_neuro_brain` SHOULD be sent at most once every 6 hours.

### Profiles

Each synced profile has a *link id*: the UUID of the profile that first published it. The `profiles` collection holds `{"link", "name", "hlc", "deleted"}` records, merged last-writer-wins by `hlc`.

Each device keeps its own map from local profile to link id, and which links it syncs. Profiles that aren't selected never leave the device. Batches for a selected profile that isn't active are kept on the device and applied when that profile becomes active, because both apps run one profile at a time.

### Snapshots

A snapshot holds the merged state of one link (or of `profiles`) as blobs, plus a manifest in the writer's log:

```
{"head":"<roster head>","link":"<link id>|null","parts":[{"blob":"<hex>","collection":"…","size":n}],"vv":{"<did>":seq}}
```

`vv` is the version vector the state includes: for each sender, the last `seq` merged. Merges are state-based, so any device's snapshot is valid, and a new device can start from any snapshot and then read each log after `vv`.

A device SHOULD write a snapshot for a link when it has merged more than 1 MiB of batches since the last snapshot of that link, when the last one is 7 days old, and after starting an epoch with `remove`.

### Acknowledgements

After applying, a device appends an ack: `{"vv":{"<did>":seq}}`, the last `seq` of every sender it has consumed. A batch skipped on purpose (an unselected link) counts as consumed.

### Garbage collection

An object of sender X at `seq` n MAY be deleted when:

- every current device's latest ack has `vv[X] ≥ n`, and
- for every link, and for `profiles`, a snapshot acked by every current device has `vv[X] ≥ n`.

A snapshot manifest and its blobs MAY be deleted when a newer snapshot of the same link has a version vector at least as large for every sender and every current device has acked it. Removed devices don't count.

Garbage collection is done by devices, on every backend: each device deletes only its own objects, and any current device may delete the objects of a removed device. The server can't read acks, so it never decides on its own what to delete.
