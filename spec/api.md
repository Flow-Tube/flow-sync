# Server API v1

The Flow server is a store ([store.md](store.md)) with extras: authenticated access, linear roster appends, one cursor over new objects, quotas, a pairing mailbox and the live relay. It stores and forwards ciphertext, verifies signatures, and never decrypts.

## General rules

- Base path `/v1`. Requests and responses are `application/json` (UTF-8, unknown fields rejected) or `application/octet-stream` for objects. Any other `Content-Type` is rejected with 415.
- Errors are `{"error":"<code>"}` with the status below. Messages never echo input.
- No HTML except a one-line plain-text status at `/`. No CORS headers: there is no browser client.
- Every response carries `Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `Strict-Transport-Security: max-age=31536000; includeSubDomains` (browsers ignore it over plain HTTP).
- An instance that hasn't been claimed answers only `/v1/health`, `/v1/info` and `/v1/claim`.

| Code | Status | Meaning |
|---|---|---|
| `invalid` | 400 | Malformed request, failed schema or failed object checks |
| `unauthorized` | 401 | Missing, expired or revoked token |
| `forbidden` | 403 | Valid token, but not allowed for this path |
| `not_found` | 404 | No such object |
| `conflict` | 409 | Different bytes already at this path, or a stale roster head |
| `declined` | 410 | A member declined this join request |
| `too_large` | 413 | Over a size limit |
| `unsupported` | 415 | Wrong `Content-Type` |
| `quota` | 507 | Instance storage quota reached |
| `rate_limited` | 429 | With `Retry-After` in seconds |
| `unclaimed` | 503 | The instance hasn't been claimed yet |

## Authentication

Devices have no passwords. A device proves it holds a roster key and gets a short-lived token.

```
POST /v1/auth/challenge   {"did":"<hex>"}
→ 200 {"challenge":"<b64, 32 bytes>","instance":"<hex, 16 bytes>","group":"<hex, 16 bytes>","time":<ms>}

POST /v1/auth/token       {"did":"<hex>","challenge":"<b64>","sig":"<b64>"}
→ 200 {"token":"<opaque>","expires":<ms>}
```

- `sig` signs `"FLOW-SYNC/2 auth" ‖ instance ‖ group ‖ challenge` with the device's roster key. Devices pin `instance` when they pair (it is part of the store settings in `welcome`) and refuse any other value, so a malicious server can't relay a challenge from another instance.
- A challenge is issued only for a current member's `did` (others get 401), is single-use, and expires after 60 seconds.
- A token lasts at most 15 minutes and is bound to the `did`. Every request re-checks that the `did` is still a current device, so removal and leaving take effect at once.
- `time` lets a device notice clock drift; no protocol step depends on it.
- `group` lets a device restoring from the recovery key, which knows only the server, sign in. The group id isn't secret: every object header carries it.
- Requests send `Authorization: Bearer <token>`.

Tokens are bearer tokens. That is acceptable because data integrity never depends on them: every object is signed end to end, and object names are immutable, so a replayed write changes nothing.

### Admin token

The operator sets `FLOW_SYNC_ADMIN_TOKEN`, or `FLOW_SYNC_ADMIN_TOKEN_FILE` naming a file. The server keeps only its SHA-256 and compares in constant time. It claims the instance, and gates `/v1/admin/*` unless `FLOW_SYNC_ADMIN=off`.

## Endpoints

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /v1/health` | none | | `{"status":"ok"}` |
| `GET /v1/info` | none | | `{"api":["v1"],"protocol":["FLOW-SYNC/2"],"claimed":bool,"live":bool,"limits":{…}}` |
| `POST /v1/claim` | admin | `{"entry":<genesis>,"wraps":{"<did>":"<b64>"}}` | 201. Creates the group. Refused once claimed. |
| `POST /v1/auth/challenge` | none | see above | |
| `POST /v1/auth/token` | none | see above | |
| `GET /v1/roster?after=<seq>` | token | | `{"entries":[…]}`, ascending, at most 500 |
| `POST /v1/roster` | token | `{"entry":…,"wraps":{"<did>":"<b64>"},"chain":"<b64>"}` with `If-Match: "<head hex>"` | 201, or 409 `{"error":"conflict","head":"<hex>"}` |
| `GET /v1/keys/<epoch>/<did>.k` | token | | The caller's own wrap only, 80 bytes |
| `GET /v1/keys/<epoch>/chain.k` | token | | The chain box |
| `PUT /v1/objects/<path>` | token | object bytes | 201 created, 200 identical bytes already present, 409 different bytes |
| `GET /v1/objects/<path>` | token | | object bytes |
| `DELETE /v1/objects/<path>` | token | | 204 |
| `GET /v1/changes?after=<cursor>&limit=<n>` | token | | `{"objects":[{"path":…,"size":n}],"cursor":"<opaque>"}`, in arrival order |
| `POST /v1/pair` | token | `{"slot":"<hex>"}` | 201 `{"expires":<ms>}` |
| `PUT /v1/pair/<slot>/<name>` | slot | box bytes | 201 |
| `GET /v1/pair/<slot>/<name>` | slot | | box bytes, or 404 |
| `DELETE /v1/pair/<slot>` | token | | 204 |
| `POST /v1/join` | admin | `{"id":"<hex>","name":"…"}` | 201 `{"expires":<ms>}`, or 409 when the id exists or 3 requests are pending |
| `GET /v1/join` | token | | `{"requests":[{"id","name","expires"}]}`: pending requests not answered or declined yet |
| `PUT /v1/join/<id>` | token | `{"code":"<QR code JSON>"}` | 201, 404 when unknown or expired, 409 when already answered or declined |
| `GET /v1/join/<id>` | admin | | `{"code":"…"}`; 410 `declined` when a member declined, until the request expires; otherwise 404 until a member answers |
| `DELETE /v1/join/<id>` | token | | 204: a member declined. 404 when unknown or expired, 409 when already answered or declined |
| `GET /v1/live` | token | WebSocket upgrade | see [live.md](live.md) |
| `GET /v1/status` | token | | `{"used":bytes,"quota":bytes,"objects":n,"devices":{"<did>":{"seen":<ms>}}}` |
| `GET /v1/admin/usage` | admin | | as status, plus roster size |
| `POST /v1/admin/reset` | admin | `{"confirm":"reset"}` | 204. Deletes every group object; the instance becomes unclaimed. |
| `GET /.well-known/security.txt` | none | | [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) `Contact` and `Expires`, from the operator's settings |

### Roster appends

The server validates an append with the reference roster rules ([protocol.md](protocol.md#validation)) and appends linearly: `If-Match` must name the current head. When the entry starts an epoch, the request MUST carry a wrap for every `did` in `epoch.to`, and `chain` for epochs above 0. An `add` entry MUST carry the new device's wrap of the current epoch. Any other entry carries no wraps. The entry, its wraps and its chain box are stored atomically. A `remove` or `leave` entry revokes the tokens of the devices it removes in the same transaction.

### Objects

`<path>` is a store path ([store.md](store.md#layout)) under `dev/`. Roster entries, wraps and pairing messages have their own endpoints.

- **Writes.** A device writes only under `dev/<its did>/`. The server checks that the body is a well-formed envelope or blob: length, magic, suite, group, sender equal to the caller, `seq` equal to the path, the current epoch, a valid signature, and for blobs a SHA-256 equal to the name.
- **Deletes.** A device deletes its own paths, and any path of a removed device.
- **Reads.** Objects are served as `application/octet-stream` with `Content-Disposition: attachment; filename="flow-sync.bin"`, only to current devices. The server never parses, transforms or executes stored content.

Garbage collection is client-driven, as on every backend ([protocol.md](protocol.md#garbage-collection)). The server can't read acks, so it never decides on its own what to delete. It deletes expired pairing slots and challenges.

### Pairing mailbox

A member opens a slot with `slot = Hash("pair", t)[0..16]`. Knowing the slot id is the capability: the new device has no token yet, and only someone who read the QR code knows `t`. A slot holds at most 8 messages of at most 8 KiB in each direction, expires after 180 seconds, and an instance holds at most 3 open slots. Devices poll the mailbox no more than once every 2 seconds, which keeps a device without a token inside the per-address request limit.

## Limits

| Limit | Value |
|---|---|
| JSON request body | 64 KiB |
| Object or blob | 4 MiB |
| Roster entry | 16 KiB |
| Roster page | 500 entries |
| Cursor page | 1,000 objects |
| Body read timeout | 30 s |
| Live message | 64 KiB |
| Live rate | 20 messages per second per device |
| Requests | 600 per minute per device; 120 per minute per IP for requests without a valid device token, whatever headers they carry |
| Failed authentication | exponential backoff per IP; a 15-minute ban after 10 failures, which doesn't apply to requests with a valid device token |
| Admin token failures | a 15-minute ban per IP after 5 failures |
| Instance quota | set by the operator; `FLOW_SYNC_QUOTA`, default 2 GiB |

`/v1/info` reports the limits in force, so apps can adapt to a host's own caps.

## Logging

The server logs request type, status, size, duration and error code. It never logs bodies, object names beyond their type, keys, tokens, challenges or IP addresses. IP addresses are kept in memory only, for rate limits and bans, and are forgotten when the ban or window ends. Prometheus metrics are optional and off by default.
