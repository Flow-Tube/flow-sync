# Security model

What a Flow sync server can and can't see, and what its operator is trusted with. The full model, with every goal and its limits, is in [spec/threat-model.md](../spec/threat-model.md).

## What the server holds

Devices encrypt everything before it leaves them. The server stores and forwards that ciphertext, checks signatures, and never holds a key that opens it.

| The server can see | The server can't see |
|---|---|
| How many devices are linked, and their public keys | Watch history, likes, playlists, subscriptions, notes, settings, interests |
| How many objects each device writes, their padded sizes, and when | Profile names and which profiles sync |
| When each device last connected, and which are on the live channel | Device names (they're sealed inside the roster) |
| IP addresses, in memory only, for rate limits and bans | What is playing, or which device controls which, on the live channel |

Logs record the time, the route pattern, the status, the size, the duration, an error code and, for an unexpected error, its type. They never record bodies, object names, keys, tokens or IP addresses.

## What an operator can and can't do

Whoever runs the server, or breaks into it, can:

- delete the group or refuse service: an admin reset wipes it, and any store can stop answering;
- withhold or roll back objects. Devices notice once they compare state (an ack, the LAN, a second store), and refuse to go backwards;
- read the token secret in the database and act as any device towards the server, which again exposes only ciphertext.

They can't:

- read or change synced data: objects are sealed per object and signed by their device;
- add a device to the group: that needs a member's signature and the new device's own, and a new device checks the roster it was shown during pairing;
- keep a removed device reading: removal starts a new group key that only the remaining devices receive.

## The admin token

The admin token claims the instance once, lets a device ask to join with it (a member still has to accept), shows usage, and resets the instance. The server keeps only its SHA-256 and compares in constant time; five wrong tries ban the address for 15 minutes. It is a static secret, so keep it in the host's secret store and set `FLOW_SYNC_ADMIN=off` once the group is set up. Turning admin off doesn't affect linked devices.

## Device tokens

A device signs a single-use challenge with its roster key and gets a token that lasts at most 15 minutes. Every request checks that the device is still in the roster, so a removed device is shut out at once. Tokens are bearer tokens; that is acceptable because no data depends on them: objects verify themselves, and object names are never reused.

## Known limits

- An admin reset doesn't replace the token secret. If it ever leaked, it stays useful against the next group on the same instance (still ciphertext only); start from a new database to replace it.
- Uploads that arrive at the same moment can each pass the quota check, so the quota can be exceeded by up to 4 MiB per concurrent upload.
- On Cloudflare Workers, rate limits are kept per isolate and are looser than on one server.
- A server that only ever talks to one device can freeze that device's view of the group without being noticed. Another device, the LAN or a second store exposes it.

## Standards

[asvs.md](asvs.md) maps the server to OWASP ASVS 5.0 Level 2 and [api-top-10.md](api-top-10.md) to the OWASP API Security Top 10, requirement by requirement. To report a vulnerability, see [SECURITY.md](../SECURITY.md).
