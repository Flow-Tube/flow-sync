# Protocol

This document covers who belongs to a group (the roster), how keys change (epochs), how devices join, leave and recover, and how data moves. The byte formats are in [store.md](store.md) and the algorithms in [crypto.md](crypto.md).

## Roster

The roster is an append-only, hash-chained log of signed entries. Every device verifies the whole chain from genesis and is its own root of trust. The server verifies entries too, but nothing it does can add a member.

### Entry

An entry is a canonical JSON object:

| Field | Type | Present | Meaning |
|---|---|---|---|
| `v` | int | always | `2` |
| `group` | hex | always | The 16-byte [group id](crypto.md#group-id) |
| `seq` | int | always | 0 for genesis, then +1 per entry |
| `prev` | hex | always | SHA-256 of the previous entry; 32 zero bytes for genesis |
| `op` | string | always | `genesis`, `add`, `remove`, `leave`, `rotate`, `rename`, `restore` or `recovery` |
| `signer` | hex | always | The signing member's `did` |
| `add` | array | when adding | Subjects `{"did", "sig", "kem", "role"}`, sorted by `did`; `sig` and `kem` are b64 public keys; `role` is `device` or `recovery` |
| `remove` | array | when removing | Hex `did`s, sorted |
| `cut` | object | on `remove` and `leave`, for a device with objects | `did → {"seq": n, "hash": hex}`, the last object of that device's log the signer accepts ([Removal](#removal)) |
| `epoch` | object | when starting an epoch | `{"n": e, "kc": b64(kc_e), "to": [did, …]}`, with `to` sorted |
| `meta` | object | optional | `did → b64(Box(P_e,roster, "FLOW-SYNC/2 meta" ‖ group ‖ u64(seq) ‖ did, payload))`, where the payload content is canonical JSON `{"app", "name", "platform"}`, and `e` is the epoch in force after this entry |
| `sigs` | object | always | `did → b64(signature)` |

Absent fields are omitted, never `null` or empty.

- **Signatures** cover `"FLOW-SYNC/2 roster" ‖ canonical(entry without "sigs")`.
- **Entry hash** is `SHA-256(canonical(entry))`, including `sigs`. The next entry's `prev` is this hash.
- **`app`** in `meta` is the installation's FLOW-SYNC/1 `deviceId`, so both protocols can show the same device.

### Validation

A device keeps the roster state: the last `seq` and hash, the current epoch `n` and `kc`, and the members (`did`, keys, role, and for the recovery member whether it has been used and which device set it), whether a device has left since the current epoch started, so a `rotate` is due, and for every member it ever had the epoch it was added under, the last epoch it could write under once it is gone, and its `cut` ([store.md](store.md#reading-an-envelope)). An entry is valid against that state when all of these hold:

1. `v` is 2, `group` matches, `seq` is the last `seq` + 1, and `prev` is the last hash. Genesis has `seq` 0 on an empty state, and its `group` is the id its subjects commit to ([crypto.md](crypto.md#group-id)).
2. `signer` is a current member, and `sigs[signer]` verifies under its key.
3. Every subject in `add` has `did = Hash("device", sig ‖ kem)[0..16]`, a valid Ed25519 public key ([crypto.md](crypto.md#ed25519-checks)), a `did` never seen before in this roster, and a valid `sigs[did]`. That reverse signature proves the subject agreed to join.
4. The `op` rules hold:

| `op` | Signer | Must contain | Must not contain | Effect |
|---|---|---|---|---|
| `genesis` | the device in `add` | `add`: one `device`, one `recovery`; `epoch` with `n` 0 | `remove` | Creates the group |
| `add` | a device | `add`: one `device` | `remove`, `epoch` | Adds a device |
| `remove` | a device | `remove`: one or more devices, not the signer; `epoch`. When rule 8 applies, `remove` also names the recovery member and `add` has one `recovery` | `add`, unless rule 8 applies | Removes devices and starts an epoch |
| `leave` | a device, not the last one | `remove`: exactly the signer | `add`, `epoch` | The signer stops being a member ([Leaving](#leaving)) |
| `rotate` | a device, unless rule 8 applies | `epoch` | `add`, `remove` | Starts an epoch for the current members |
| `rename` | a device | `meta` for exactly one current device | `add`, `remove`, `epoch` | Changes a name |
| `restore` | the recovery member, not used yet | `add`: one `device`; `epoch` | `remove` | Adds a device, starts an epoch, marks the recovery member used |
| `recovery` | a device | `remove`: the current recovery member; `add`: one `recovery`; `epoch` | | Replaces the recovery key and starts an epoch |

5. When `epoch` is present, `n` is the current epoch + 1 (0 for genesis), and `to` is exactly the set of members after the entry.
6. `meta` keys are members after the entry.
7. `cut` appears only on `remove` and `leave`, isn't empty, and names only devices in `remove`. Each `seq` is from 1 to 2<sup>53</sup> − 1.
8. The device that set a recovery key is the signer of the `recovery` or `remove` entry that added it. A recovery key from `genesis` has none. While that device isn't a member, or the entry removes it, the key is *due*: a `remove` must replace it, in that same entry, and a `rotate` isn't valid. A `remove` must not replace a key that isn't due.

A device can use epoch `e` only after unwrapping `K_e` from its own wrap and checking it against `kc`. It unwraps first and applies the entry only if that works. Otherwise it stays on the chain it had, stops writing, and retries. A device whose LAN session can't open on the settled chain for this reason opens it on the chain it had, to pull what's missing. A recovery member that has signed a `restore` can never sign again. The restored device MUST replace it with a `recovery` entry right away, which shows the user new words.

### Forks

The Flow server appends linearly: an append names the current head and fails if another append got there first.

WebDAV, S3 and LAN peers can't do that, so two devices may append at the same `seq`. Entries are stored under names that include their hash, so both survive. Every device settles the roster from all the entries it holds, including every entry it has already applied, and the result depends only on which entries it holds, not on the order it read them.

Only entries valid against the chain from genesis to their own `prev` count. A roster with more than 4096 such entries is refused. Among those:

1. An entry `y` *revokes* an entry `x` when `y.remove` names `x.signer`, and `x` is neither `y` nor an ancestor of `y`. So a removal is final whichever branch holds it, and the entries a remover built on stay valid. A `recovery` entry revokes in the same way, since it removes the old recovery member.
2. An entry *falls* when an entry that stands revokes it, or when its parent falls. It *stands* when its parent stands (a genesis has none) and every entry that revokes it has fallen. These are applied until nothing changes. An entry left undecided is *contested*.
3. If nothing is contested, the chain is picked from genesis, one `seq` at a time, among the standing children of the entry picked before. Lowest rank wins: `remove` 0, `leave` 1, `recovery` 2, `restore` 3, `rotate` 4, `add` 5, `rename` 6, `genesis` 7. Removal wins so a revoked device can't win with a concurrent entry. `leave` comes next, so an entry that starts an epoch at the same `seq` is re-applied on top of it and leaves the departed device out. `rotate` comes after the other entries that start an epoch, because any of them makes it unnecessary.
4. For equal rank, the lowest entry hash (as bytes) wins.

Losing entries, and everything built on them, are ignored, except that the key of a losing entry that stands can still open what was sealed under it ([store.md](store.md#reading-an-envelope)). A device whose entry lost re-applies its change on top of the winner. A device that holds a verified genesis never replaces it, whatever else it holds.

#### Contested rosters

A contested roster has no winner the protocol can name, because each side validly removes the other. A device that holds one pauses sync, reads and writes both, stays on the chain it had applied, deletes nothing, and asks the user which side to keep. The sides are the contested entries that revoke another contested entry. The device stores the chosen entry's hash in a local list. A listed entry can't be revoked, so the roster settles and sync resumes. The list never leaves the device, so each device asks for itself.

#### What a device does with a store's answer

The device compares the chain it has applied with the chain settled from the store's answer and what it holds:

| Case | What the device does |
|---|---|
| The settled chain extends the applied one | Applies the new entries |
| An applied entry is missing from the store's answer | Stops writing and warns that the store rolled back |
| The settled chain differs from the applied one, on WebDAV, S3 or a LAN group | Returns to the last common entry and applies the settled chain |
| The settled chain differs from the applied one, on a Flow server | Stops writing and warns: a linear store has no honest way to do this |
| The roster is contested | Pauses and asks, as above |

On a Flow server the server's answer decides while it answers. Entries that arrived from LAN peers are held, but they don't count against it. While it doesn't answer, the device settles from what it holds, and a later answer that disagrees is the Flow server case above.

A device MUST NOT seal anything under an epoch its own entry started until it has re-read that `seq` from the store and found its entry still winning. Other devices adopt an epoch only once they see the winning entry.

## Pairing

Pairing joins a new device N to the group through a member M. Whichever device has a camera scans; the other shows the QR code.

### QR code

Canonical JSON, at most 512 bytes:

```
{"v":2,"t":b64(16 random bytes),"c":b64(commitment to the ephemeral X25519 public key),
 "r":"m" or "n", "d":"device name", "s":{store}, "l":[{"a":"192.168.1.20","p":49210}]}
```

- `c` is `Hash("pair commit", e_A_pub)` ([crypto.md](crypto.md#pairing)). The key itself comes later, on the channel. A device refuses a code without `c`.
- `r` is the role of the device showing the code: `m` member, `n` new.
- `s` is shown only by a member: `{"k":"server","u":"https://…"}`, `{"k":"webdav","u":"https://…/flow-sync/"}`, `{"k":"s3","u":endpoint,"b":bucket,"g":region,"x":prefix}` or `{"k":"lan"}`. It never contains credentials.
- `l` lists LAN addresses where the shower listens, using the same address rules as FLOW-SYNC/1. A new device always lists them, because it knows no store yet.

FLOW-SYNC/1 apps reject `v:2` and ask the user to update. FLOW-SYNC/2 apps still accept `v:1` codes.

### Channel

The scanner reaches the shower over the LAN when an `l` address answers. Otherwise, when the shower is a member, it uses the store's pairing mailbox ([store.md](store.md#pairing-mailbox)). On a Flow server the mailbox needs no credentials. On WebDAV and S3 it does, so the scanner uses it only when the user entered that store's credentials before scanning; otherwise both devices must be on the same LAN. Two messages travel in the clear first, so that each side is bound to its key before it sees the other's:

1. The scanner sends its ephemeral X25519 public key (32 bytes) followed by `proof` (16 bytes, [crypto.md](crypto.md#pairing)).
2. The shower checks `proof`. If it's wrong, the shower reveals nothing and the code stays usable. If it's right, the shower sends its ephemeral X25519 public key (32 bytes).
3. The scanner checks that key against `c` from the code, and stops if it doesn't match.

Both sides then derive `K_ab`, `K_ba` and the SAS. Every later message is a box, numbered from 0 in each direction.

**A shower reveals its key at most once per code,** whichever way the scanner arrives, and serves no other scanner after that. If pairing then fails or is cancelled, the code is finished and pairing again needs a new one. This is what limits anyone in the middle to one guess at the digits, so it's not optional. A code's keys live only in memory.

- **LAN:** the scanner tries the `l` addresses in order, each with a 3-second connect timeout, and opens a WebSocket to `ws://<a>:<p>/flow-sync/2/pair`. The first binary frame in each direction is the message above; every later frame is one box. Until it has revealed, the shower waits on up to 8 connections at once, and drops one whose first frame has a wrong `proof` or doesn't arrive within 5 seconds. The first good one takes the reveal, and it drops the rest.
- **Mailbox:** the messages above are the first file in each direction, and boxes follow from the second file. A wrong `proof` ends the mailbox path for that code; the LAN path, if any, stays open.

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
| 4 | M | `welcome` | `group`, `head` and `seq` (the roster head after the `add`), `link` (the link id of the member's Default profile if it syncs, whichever profile the member runs, and otherwise a new link id that no profile uses yet; the new device's Default profile joins it, so it never joins another device's non-Default profile), and `store`: for a Flow server `{"k":"server","u":url,"i":instance}`, for WebDAV `{"k":"webdav","u":url,"n":user,"w":password}`, for S3 `{"k":"s3","u":endpoint,"b":bucket,"g":region,"x":prefix,"y":"path" or "host","a":access key id,"s":secret}` (credentials travel only inside the pairing boxes and are stored in the platform keystore), for a [LAN group](live.md#lan-groups) `{"k":"lan"}`, with `entries` and `wrap` next to it |
| 5 | N | `done` | N has verified the roster from genesis to that head, unwrapped `K_e` and checked `kc` |

Over the LAN, `join` and `welcome` also carry `p`, the port of the sender's [LAN service](live.md#discovery). Each device remembers the other's address on the pairing connection with that `p`, so they can meet again where mDNS doesn't reach.

A user who says the digits differ is told that nothing was shared, that pairing needs a new code, and that if it happens again someone may be interfering. A scanner whose check against `c` fails says the same.

N pins the head from `welcome`. A store that later shows N a different history at or below that `seq` is treated as a fork.

### Joining with the admin token

On a Flow server, a new device can ask to join instead of scanning a code ([api.md](api.md)):

1. The new device posts a join request with the admin token: a random 16-byte `id` (hex) and its device name, at most 64 characters. A request lasts 180 seconds, and at most 3 are pending.
2. Linked devices list pending requests while Linked devices is open and on each sync, and ask the user whether to accept the request, saying that the name isn't verified and to accept only if they started this on the other device.
3. A member that accepts makes an offer exactly as for a QR code, posts the code to the request, and waits as the shower through the pairing mailbox. A member that declines marks the request declined; it then no longer counts toward the 3 pending.
4. The new device polls its request with the admin token until the code arrives, then pairs as the scanner of that code. If a member declined, the poll answers `declined` until the request would have expired, and the new device stops and tells the user. A request that expires unanswered reads as unknown.

Here the code passes through the server, which can read or replace it, so the code authenticates nothing and only the six-digit check decides. The commitment and the single reveal limit a server in the middle to one guess at the digits per attempt (1 in 10<sup>6</sup>), and a wrong guess shows the user different digits. A server can also use up an offer, which is no more than refusing service.

## Removal

Any remaining device can remove one or more devices, including one that is lost:

1. Read every log it can, then generate `K_(e+1)`. Write a wrap for each remaining member, including the recovery member, and the history chain box.
2. Append a `remove` entry with `epoch` `n = e + 1`, `kc` and `to`, and for each removed device with objects its read position in that device's log as `cut`.
3. The server revokes the removed devices' tokens on that append. On WebDAV and S3 the removed device still has what the store allows until [its login is replaced](#replacing-a-stores-login). If it had a login of its own, revoking that is enough.
4. Soon after, write a new snapshot under `e + 1` for each link it can ([Snapshots](#snapshots)), so new devices don't depend on older epochs.

A device can install things while it is linked, and a removal doesn't undo them on its own. If it set the recovery key, rule 8 replaces the key in the same entry, and the user is shown new words straight after. The removal doesn't wait for them, because removing a stolen device is urgent. Before the removal, the device lists the current devices that the removed ones added, following those devices' additions in turn, and lets the user remove them too. Nothing is removed by default: nearly every device descends from the first one, and the user is the only one who knows which are theirs.

Old objects are not re-encrypted: the removed device already had them. They leave through garbage collection.

The `cut` is where that device's log ends. Readers stop there, so what it writes after its removal is never read ([store.md](store.md#reading-an-envelope)). A removed device with no `cut` has no objects anyone reads from then on. A device that had already read past the `cut` keeps what it applied. Objects above the `cut` that the signer hadn't read are dropped, so the user is told that recent changes from that device may not arrive. When a fork holds two removals of a device, the `cut` of the entry on the chain decides.

A device that finds itself missing from a settled roster stops syncing and tells the user. It deletes its device keys and the group's epoch keys by itself only when the entry that removes it extends the chain it had applied and nothing is contested. In any other case it deletes them only when the user confirms. On a Flow server it can no longer read the roster: once the server refuses it a token, it stops syncing and tells the user, who can forget the group, which deletes the same keys.

## Replacing a store's login

On WebDAV and S3, devices usually share the login `welcome` hands out, and the store can't tell them apart. A removed device that kept it can read, write, overwrite and delete anything there. So on these stores a removal is complete only once the login has changed. The new login has to reach the other devices while the old one still works:

1. **Notice.** From applying a `remove` until it has read a [store login](store.md#store-logins) sealed at that entry's epoch or later, a device tells the user that the removed device can still reach the store. A `leave` doesn't call for it: that device deleted its login. The user can also start a change at any other time.
2. **Enter.** The user types the new login, before setting it at the provider. The device re-reads the roster, stops if it is contested, and writes a store login to its own log under the current epoch. The user SHOULD do this on the device that made the removal.
3. **Wait.** The device shows which current devices have read the object, from their acks. The user can go on without one. That device will need the login typed in.
4. **Change.** The user sets the login at the provider. Where the provider has app passwords, the user creates the new one and then revokes the old one.
5. **Done.** The device checks the new login against the store and its group id, and saves it.

A device keeps the latest store login it read as a pending login, in the same keystore as its login. When the store refuses its login, it tries the pending one once, checks the group id, and saves it. If the store refuses that too, it stops, as for any refused login ([store.md](store.md#webdav)).

## Leaving

A device can't sign its own `remove`, and must never hold the key of the epoch that shuts it out. So it leaves with an entry that changes no keys, and the devices that stay start the next epoch:

1. The leaving device appends a `leave` entry signed by itself, with only its own `did` in `remove`, and its own last object as `cut` if it wrote any. The last device of a group can't leave; it can only forget the group.
2. The server revokes its tokens on that append. The device then deletes its device keys, the group's epoch keys and everything it stored for the group. On WebDAV and S3, the user should also revoke its login if it had its own.
3. If the device that left had set the recovery key, that key is due (rule 8), and no background step can show new words. So devices keep reading, write nothing, and ask the user for new words. The `recovery` entry starts the epoch. A user who is leaving a device that set the key is told this first.
4. Otherwise, a device that sees a `leave` not yet followed by an entry that starts an epoch appends a `rotate` before it writes any new object: it generates `K_(e+1)`, writes a wrap for each current member, including the recovery member, and the history chain box, and appends `rotate` with `epoch` `n = e + 1`. Devices that rotate at the same time make a fork, resolved as above; a device whose `rotate` lost adopts the winner's epoch and doesn't rotate again.
5. The device that rotated writes new snapshots under `e + 1` soon after, as after a removal.

From its `leave` on, the device counts as removed everywhere in this document: its acks no longer hold back garbage collection, and any current device may delete its objects. To join again it pairs with new device keys, so it gets a new `did` and a new log.

## Recovery

Setup shows the recovery key once, as 24 words and a QR code, and asks for two of the words back before it counts the key as saved. Until then, Linked devices shows that the key isn't confirmed.

To restore onto a new device, the user enters the words and the store location (and WebDAV or S3 credentials). The device:

1. Derives the recovery keys and reads and verifies the roster.
2. Unwraps the latest `K_e` from the recovery member's wrap and checks `kc`.
3. Shows the current devices by name and asks which ones the user still has. None is chosen by default, and the question says that restoring signs out every other device. Nothing is written before the answer.
4. Creates fresh device keys, writes wraps of `K_(e+1)`, and appends a `restore` entry signed by the recovery key.
5. Immediately creates a new recovery key, appends a `recovery` entry, and shows the new words.
6. Reads every log, then [removes](#removal) every current device the user didn't choose. It works out that list when it removes, as all current devices except the chosen ones, so a device that appears after the question goes too. When there is none, it skips this step. A read the device cut short to stay within its own limits isn't finished: it keeps its place, goes on at the next sync, and removes only once it has reached the end. A log that stops at an object it can't get or has to discard ends there, as a gap does, since that object may never become readable.
7. Links its Default profile like a `welcome` would. When change batches and snapshot manifests name one link for profile data, it joins that link; when they name none, it starts a link with its own profile id; when they name several, the user picks one from the `profiles` records, or starts a new link. It writes no batch before that.

Rule 5 wraps the keys of steps 4 and 5 to every member, including devices the user no longer has. So until step 6 is done the device seals nothing under them but its own name in `meta`: no object and no live message. The device saves the answer with the group, so one that stops before then resumes at step 6. Devices are removed by default here, unlike in a [removal](#removal), because the user has said they lost them. A device that was still in use shows that it was removed, and can be linked again.

Any device can append a `recovery` entry at any time, for example after losing the words. The old recovery member stops receiving epoch keys.

Every other device tells the user when it applies a `restore`, a `recovery` entry, or a `remove` that replaces the key, signed by another device: which device or recovery key did it, and when this device learned of it, since the words the user holds may have just stopped working. The notice stays until answered. If the user didn't do it, the answer leads to removing that device.

## Sync

### Streams

Each device writes one log: a sequence of objects numbered from 1, each naming the SHA-256 of its predecessor ([store.md](store.md#envelope)). The log holds change batches, snapshot manifests and acknowledgements. Live messages use a separate counter ([live.md](live.md)).

A reader keeps, per sender, the last `seq` and hash it verified:

- The next object must have `seq` + 1 and the matching `prev`.
- An object at or below the last `seq` is a replay and is ignored. If its bytes differ from what was verified, the store is misbehaving and the device warns.
- A gap means the store is withholding, or hasn't caught up. The reader waits; it doesn't skip.
- A device that has never read a sender starts at its first object (`seq` 1, `prev` all zeros), or right after the sender's entry in the version vector of the snapshot it bootstraps from ([several links](#reading-a-link-from-its-snapshot)). A store therefore can't hide the beginning of a log.
- A log of a removed device ends at its `cut` ([store.md](store.md#reading-an-envelope)).

A device that sees any sender's `seq` go backwards stops writing and warns that the store rolled back. For the roster, see [What a device does with a store's answer](#what-a-device-does-with-a-stores-answer).

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

- **Linking.** A local profile either starts a link with its own id, or joins a link listed in `profiles`, and its local data then merges with the link's. A device can also create a local profile for a link it doesn't sync yet. A profile that joins a link [reads it from its snapshot](#reading-a-link-from-its-snapshot) before it sends batches for that link. A device sends a profile's data only while that profile is active, so it links only its active profile and switches to another profile before linking it. A local profile created for a link starts with no data of its own and needs no switch.
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

A device starts reading a link when it bootstraps, and when it links a profile to a link it hasn't been reading. It takes the newest snapshot of that link it can open, using one from a removed device only when the walk down from that device's `cut` reaches its manifest ([store.md](store.md#reading-an-envelope)), then reads each sender's log from that snapshot's `vv` and applies only that link's batches, up to where it had already read. A link with no snapshot is read from each log's first object. Bootstrapping several links at once, a device reads each log from the lowest `vv` entry among their snapshots and skips a link's batches that its own snapshot already includes. [Garbage collection](#garbage-collection) keeps every object that a link's snapshots don't cover, so these are still in the store.

### Acknowledgements

After applying, a device appends an ack: `{"vv":{"<did>":seq}}`, the last `seq` of every other sender it has consumed. A batch skipped on purpose (a link the device doesn't sync), or kept for a profile that isn't active, counts as consumed. A device has always read its own log, so its acks leave itself out. Acks aren't acknowledged: a device writes one only after consuming batches or snapshot manifests, and its next ack covers any acks it read before.

### Garbage collection

An object of sender X at `seq` n MAY be deleted when:

- every current device other than X has a latest ack with `vv[X] ≥ n`, and
- for every link that batches name, except links whose `profiles` record is deleted, and for `profiles` once a device writes it, a snapshot that every current device has acked has `vv[X].seq ≥ n`. A device has acked a snapshot when its latest ack covers the manifest's `seq` in its writer's log.

A snapshot manifest and its blobs MAY be deleted when a newer snapshot of the same link has a version vector at least as large for every sender, every current device has acked that newer snapshot, and every current device's latest ack has `vv[X] ≥ n` for the manifest's own `seq` n, so no reader meets the gap it leaves. Removed devices don't count.

Objects of a removed device above its `cut` are never read, so any current device MAY delete them as soon as it sees them. Garbage collection is done by devices, on every backend: each device deletes only its own objects, and any current device may delete the objects of a removed device. The server can't read acks, so it never decides on its own what to delete.
