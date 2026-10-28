# Threat model

No system is attack-proof. FLOW-SYNC/2 aims for defence in depth, and for a complete breach of any store to leak no user data.

## Assets

| Asset | Description |
|---|---|
| User data | Watch history, interests (FlowNeuro and MusicBrain state), likes, playlists, subscriptions and groups, settings, notes, profile names |
| Device keys | Each device's Ed25519 signing key and X25519 key |
| Group keys | The 256-bit key of each epoch and every key derived from it |
| Recovery key | The 256-bit recovery secret, shown once as 24 words and a QR code |
| Availability | Sync keeps working, and a broken or hostile store can't corrupt local data |

## Adversaries

| | Adversary | Capabilities |
|---|---|---|
| A1 | Network attacker | Passive or active on any path between a device and a store, and on the LAN |
| A2 | Store | A malicious or breached server operator, hosting platform, database, S3 or WebDAV provider. Reads and changes everything it stores, at any time, and can withhold, replay, reorder or roll back |
| A3 | Internet attacker | Scanners, exploit kits, denial of service, oversized or malformed input and replay against an exposed server |
| A4 | Lost or stolen device | Has everything the device had, before and after the device is removed |
| A5 | Supply chain | A compromised dependency, base image, CI job or release step |

## Goals

| Goal | Against | Mechanism | Limit |
|---|---|---|---|
| **G1** Confidentiality of all user data | A1 A2 A3 | Every object is encrypted with AES-256-GCM under a key derived per object from the epoch key ([crypto.md](crypto.md)). Epoch keys reach members only as HPKE wraps to their X25519 keys. The server only verifies signatures and never holds a key that opens data. | Object counts, padded sizes, timing, number of members, and device public keys are visible to the store. |
| **G2** Integrity and authenticity | A1 A2 | Every object is signed by its sender's Ed25519 key, and its header (group, epoch, type, sender, sequence, previous hash) is the AEAD's associated data. Roster entries are signed, hash-chained, and checked by every device from genesis. | A linked device that is compromised can sign anything (non-goal N2). |
| **G3** The store can't add a device | A2 | An `add` entry needs a member's signature and the new device's own signature. A new device pins the roster head it receives over the pairing channel, which both users confirmed with the 6-digit code. | None within this model. |
| **G4** A removed device reads nothing synced after removal | A4 | Removal starts a new epoch whose key is wrapped only to the remaining members. The server refuses the removed device's tokens from the moment the removal is appended. | The device keeps everything it had already received. Until it is removed, a stolen device is a linked, compromised device. |
| **G5** Reordering, replay and rollback are detected | A2 | Each device's objects carry a sequence number and the hash of its previous object. Snapshots carry a version vector. Devices remember the highest roster head and the highest sequence seen per device and refuse to go backwards. Every change batch names its sender's roster head, which exposes a forked roster. | A store that freezes the view of a device which never compares state with another device (through acks, the LAN or a second store) can't be detected. Withholding is detected only once devices compare state. |
| **G6** Minimal metadata | A2 | Device ids are hashes of public keys. Object names contain only ids, epochs and sequence numbers. Profile ids and names exist only inside ciphertext. Plaintext is padded with PADMÉ. The server stores no IP addresses and logs no content, keys or tokens. | That a sync happened, and its rough size, stay visible (non-goal N1). |
| **G7** A server compromise doesn't reach the host or other data | A3 A5 | Distroless non-root image, read-only root filesystem, all capabilities dropped, `no-new-privileges`, one data volume. One group per instance, so there are no other tenants. Signed images with build provenance and an SBOM, reproducible builds, pinned dependencies. | A host that already controls the server is out of scope (non-goal N3). |
| **G8** Availability | A3 | Size limits on every input, strict schemas, rate limits per device and per IP (IPs kept in memory only), temporary bans, storage quotas, timeouts. Apps apply each batch in one local transaction and never apply an object that fails verification. | A host's own limits (credits, daily request caps) can pause sync. A store can always refuse service. |

## Non-goals

- **N1** Hiding from the store that a sync happened, or its rough size. Padding reduces what sizes reveal.
- **N2** Protecting against a device that is still linked and compromised. Removing it restores G1 for later data.
- **N3** Protecting a server from a host that already controls it. G1 still holds, because the server never sees keys.

## Assumptions

- Each platform's CSPRNG, keystore and the libraries named in [crypto.md](crypto.md) work as documented.
- Users compare the 6-digit code during pairing. If they don't, an attacker who also has the QR code's contents could pair in their place.
- The QR code is shown only to the person pairing. Its token and ephemeral key are single-use and expire with the pairing slot.
- Users keep the recovery key private. Anyone with it can restore the group once (see [protocol.md](protocol.md)).

## Consequences of losing secrets

| Lost or stolen | Effect | Response |
|---|---|---|
| One device | The thief reads what that device had | Remove it from another device: new epoch, server revokes it |
| Every device, recovery key kept | Nothing lost | Restore onto a new device with the recovery key |
| Recovery key, devices kept | An attacker with the words can restore once | Make a new recovery key on any device; the old one stops receiving epoch keys |
| Every device and the recovery key | The data can't be recovered by anyone, including the server operator | None. This follows from G1 and is stated plainly during setup |
