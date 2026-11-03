# OWASP ASVS 5.0 Level 2

This maps the server, the deployment templates in `deploy/` and the CI workflows to every Level 1 and Level 2 requirement of [ASVS 5.0.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release). The apps are out of scope here. The API Top 10 mapping is in [api-top-10.md](api-top-10.md).

The server has no browser client, no HTML, no cookies, no sessions and no passwords. Devices sign a challenge with their roster key for a 15-minute bearer token, and the operator holds one admin token. A device token stands in for a session below.

Status is `met`, `partly`, `gap` or `n/a`. Paths are relative to `packages/server/src/` unless they start with `spec/`, `deploy/`, `docs/` or `.github/`. Tests are named as `file` "test name".

## V1 Encoding and Sanitization

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V1.1.1 | Decode input once, before validation | met | base64url and hex are decoded once at the edge, then length-checked (`group.ts:32-41`, `routes/auth.ts:20-26`) |
| V1.1.2 | Encode output as the last step | met | Bodies are built only by Hono's `c.json`, `c.text` and `c.body` (`http/errors.ts:49`, `http/body.ts:44-48`) |
| V1.2.1 | Context-aware encoding of HTTP responses | met | Responses are JSON, plain text or octets; no HTML (`routes/meta.ts:10`) |
| V1.2.2 | Encode untrusted data in built URLs | n/a | The server builds no URLs |
| V1.2.3 | Escape when building JavaScript or JSON | met | JSON is only ever serialized by `JSON.stringify`, never concatenated |
| V1.2.4 | Parameterized database queries | met | Every value is bound; table and column names are constants (`storage/sqlite-store.ts`, `storage/postgres.ts`) |
| V1.2.5 | No OS command injection | n/a | The server runs no commands |
| V1.2.6 to V1.2.8 | LDAP, XPath and LaTeX injection | n/a | None used |
| V1.2.9 | Escape regular expression metacharacters | n/a | Every regular expression is a constant |
| V1.3.1 | Sanitize WYSIWYG HTML | n/a | No HTML input |
| V1.3.2 | No eval or dynamic code execution | met | None in the code; Semgrep `p/nodejs` and `p/security-audit` on every PR (`.github/workflows/security.yml:49`) |
| V1.3.3 | Sanitize data for dangerous contexts | met | Path parameters are regex-bound (`routes/pair.ts:10-11`, `routes/keys.ts:10`, `routes/join.ts:12`) or parsed by `parseDevicePath` (`routes/objects.ts:30-35`), and only used as bound query values |
| V1.3.4, V1.3.5 | SVG and scriptable template content | n/a | Stored content is ciphertext, served as an attachment, never rendered |
| V1.3.6 | SSRF protection | n/a | No request data chooses an outbound destination |
| V1.3.7 to V1.3.11 | Template, JNDI, memcache, format string and mail injection | n/a | None used |
| V1.4.1, V1.4.3 | Memory-safe buffers, no use-after-free | n/a | Managed runtime |
| V1.4.2 | Prevent integer overflows | met | Integers are range-checked by zod (`routes/objects.ts:25-28`, `routes/roster.ts:16`); `readU64` refuses values above 2^53 (`packages/protocol/src/bytes.ts:44-49`) |
| V1.5.1 | Disable XML external entities | n/a | No XML |
| V1.5.2 | Safe deserialization | met | JSON goes into strict zod schemas (e.g. `routes/auth.ts:13-18`); envelopes and entries go through the reference parsers (`routes/objects.ts:48`, `routes/roster.ts:32`) |

## V2 Validation and Business Logic

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V2.1.1 | Document input validation rules | met | `spec/api.md` (General rules, Limits), `spec/store.md` (Envelope), `spec/protocol.md` (Validation) |
| V2.1.2 | Document consistency of combined data | met | `spec/protocol.md` Validation; `spec/api.md` Roster appends and Objects |
| V2.1.3 | Document per-user and global limits | met | `spec/api.md` Limits |
| V2.2.1 | Positive validation of all input | met | Strict schemas, regex routes and the reference parsers; `routes/objects.test.ts` "objects must match their path, sender, epoch and signature" |
| V2.2.2 | Validate at a trusted service layer | met | Every check runs on the server |
| V2.2.3 | Related data items are consistent | met | Envelope header against path, sender and epoch (`routes/objects.ts:50-55`); wraps against `epoch.to` (`group.ts:57`) |
| V2.3.1 | Business flows run in order | met | A token needs an unused challenge for the same device (`routes/auth.ts:50-54`); appends need `If-Match` on the head (`routes/roster.ts:29`); `routes/auth.test.ts` "a challenge works once, for its device, before it expires" |
| V2.3.2 | Business limits as documented | met | `limits.ts` enforced for slots (`routes/pair.ts:34`), mailbox messages (`routes/pair.ts:42`), join requests (`routes/join.ts:39`) and quota (`routes/objects.ts:79`) |
| V2.3.3 | Operations succeed whole or roll back | met | An entry, its wraps and chain are stored in one batch or transaction (`storage/sqlite-store.ts:133-160`, `storage/postgres.ts:140`); `routes/roster.test.ts` "an append naming a stale head is refused with the current head" |
| V2.3.4 | Locking for limited resources | partly | Slots and join requests are capped atomically (`storage/sqlite-store.ts:233-241`, `:274-283`), but the quota check reads usage before the write (`routes/objects.ts:79-86`), so concurrent uploads can pass it together |
| V2.4.1 | Anti-automation | partly | Limits per address, per device and per live socket (`limits/guards.ts`, `live/hub.ts:76-83`), but the per-address limit doesn't cover every request to routes that need no token (`limits/guards.ts:49`); on Workers limits are per isolate (`docs/cloudflare.md`) |

## V3 Web Frontend Security

There is no browser client and no HTML; the headers below are set anyway.

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V3.2.1 | Content not rendered in the wrong context | met | `default-src 'none'`, `nosniff`, objects as `attachment` (`app.ts:37-42`, `http/body.ts:44-48`); `app.test.ts` "every response carries the security headers" |
| V3.2.2 | Safe text rendering in the client | n/a | No browser client |
| V3.3.1 to V3.3.4 | Cookie attributes | n/a | No cookies |
| V3.4.1 | HSTS of at least a year, with subdomains | partly | Sent on every response with `includeSubDomains`, but with Hono's default `max-age` of 180 days (`app.ts:37`) |
| V3.4.2 | Fixed CORS origin | met | No CORS headers at all; `app.test.ts` "every response carries the security headers" |
| V3.4.3 | CSP with `object-src` and `base-uri` `'none'` | partly | `default-src 'none'` covers `object-src`; `base-uri` doesn't fall back to it (`app.ts:38`) |
| V3.4.4 | `X-Content-Type-Options: nosniff` | met | `app.ts:37`; `app.test.ts` "every response carries the security headers" |
| V3.4.5 | Referrer policy | met | `no-referrer` (`app.ts:39`); same test |
| V3.4.6 | CSP `frame-ancestors` | gap | Not set; only Hono's `X-Frame-Options: SAMEORIGIN` (`app.ts:37-42`) |
| V3.5.1, V3.5.2 | CSRF defenses | n/a | No ambient credentials: every authenticated call carries an `Authorization` header or a WebSocket subprotocol |
| V3.5.3 | Sensitive functions not on safe methods | met | Every state change is POST, PUT or DELETE |
| V3.5.4 | Separate applications on separate hostnames | n/a | No browser origin; each instance has its own host |
| V3.5.5 | Check `postMessage` origins | n/a | No browser client |
| V3.7.1 | Only supported client-side technology | n/a | No browser client |
| V3.7.2 | Redirect only to allowlisted hosts | met | The server never redirects |

## V4 API and Web Service

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V4.1.1 | Correct `Content-Type` with charset | met | `application/json`, `text/plain;charset=UTF-8` or `application/octet-stream` (`http/body.ts:44-48`) |
| V4.1.2 | No automatic HTTP to HTTPS redirect for APIs | partly | Caddy's automatic HTTPS (`deploy/docker/Caddyfile`) and `force_https` (`deploy/fly/fly.toml:16`) redirect; the apps use HTTPS for public addresses and refuse redirects (`spec/store.md` Transport security) |
| V4.1.3 | Intermediary headers can't be overridden | partly | Caddy replaces `X-Forwarded-For` and the server takes the last hop (`runtime/node.ts:16-21`); Workers, Vercel and Netlify read their edge's header (`entry/workers.ts:25`, `entry/vercel.ts:5`, `entry/netlify.ts:4`); the Worker sets the Durable Object's identity headers (`live/durable.ts:112-114`). The last-hop rule is unverified on Fly, Render, Railway and Heroku, and wrong if `FLOW_SYNC_TRUST_PROXY=1` is set without a proxy |
| V4.2.1 | Consistent HTTP message framing | met | Framing is left to Node's parser, Caddy and the host edges; the server parses none itself |
| V4.3.1, V4.3.2 | GraphQL limits and introspection | n/a | No GraphQL |
| V4.4.1 | WebSockets over TLS | met | The live route shares the HTTPS listener of Caddy or the host |
| V4.4.2 | Check `Origin` on the WebSocket handshake | n/a | No browser client and no ambient credentials; the upgrade needs a token in `Sec-WebSocket-Protocol` (`routes/live.ts:10-23`) |
| V4.4.3 | WebSocket tokens follow session rules | met | The same 15-minute device token, re-checked by the sweep (`live/hub.ts:106-115`) |
| V4.4.4 | WebSocket token from an authenticated HTTPS session | met | `requireMember` gates the upgrade (`routes/live.ts:22`); `routes/live.test.ts` "a connection needs a valid token" |

## V5 File Handling

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V5.1.1 | Document file types and sizes | met | `spec/store.md` Envelope and Snapshot blobs; `spec/api.md` Limits |
| V5.2.1 | Accept only sizes it can process | met | 4 MiB per object (`routes/objects.ts:68`), instance quota (`routes/objects.ts:79`); `routes/objects.test.ts` "writes stop at the instance quota" |
| V5.2.2 | Validate type and content | met | Envelopes: magic, suite, group, sender, sequence, epoch and signature (`routes/objects.ts:48-58`); blobs: SHA-256 equals the name (`routes/objects.ts:44-46`) |
| V5.2.3 | Limits before decompressing | n/a | Nothing is decompressed |
| V5.3.1 | Uploads never executed | met | Kept in the database or a bucket and served only as `attachment` (`http/body.ts:44-48`) |
| V5.3.2 | No user filenames in file paths | met | Blob keys are the SHA-256 the server computes (`routes/objects.ts:72`, `storage/s3.ts:24`) |
| V5.4.1 | Server-set filename in `Content-Disposition` | partly | `attachment` without a filename (`http/body.ts:47`) |
| V5.4.2 | Encode served filenames | n/a | No filename is served |
| V5.4.3 | Antivirus scanning | n/a | Content is end-to-end encrypted; the server can't read it (`spec/threat-model.md` G1) |

## V6 Authentication

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V6.1.1 | Document brute-force defenses and lockout | partly | `spec/api.md` Limits. Bans are per address, so every client behind one address, or behind the `"unknown"` fallback (`limits/guards.ts:47`, `auth/admin.ts:12`), is banned together |
| V6.1.2 | Context-specific password word list | n/a | No passwords |
| V6.1.3 | Document every authentication pathway | met | `spec/api.md` Authentication, Admin token and Pairing mailbox; the recovery member in `spec/protocol.md` Recovery |
| V6.2.1 to V6.2.12 | Password security | n/a | No passwords. The admin token must be at least 32 characters (`config.ts:7`) |
| V6.3.1 | Brute-force controls | met | Nothing to guess in an Ed25519 challenge; failure bans (`limits/guards.ts:45-53`, `auth/admin.ts:13-19`); `limits/guards.test.ts` "repeated failed authentication bans the address", "wrong admin tokens ban the address sooner" |
| V6.3.2 | No default accounts | met | No admin token unless the operator sets one (`auth/admin.ts:16`); `routes/claim.test.ts` "a wrong or missing admin token is refused" |
| V6.3.3 | Multi-factor or combined factors | partly | Devices prove a keystore-held Ed25519 key (`routes/auth.ts:55-58`) and the operator a static token, each a single factor; `spec/api.md` gives the rationale for device tokens only |
| V6.3.4 | No undocumented pathways | met | The routes in `app.ts:58-71` are the ones in `spec/api.md` Endpoints |
| V6.4.1 | Initial secrets random and short-lived | met | Challenges: 32 random bytes, single use, 60 s (`routes/auth.ts:35-36`, `:50`); pairing slots: 180 s (`routes/pair.ts:33`) |
| V6.4.2 | No password hints or secret questions | met | None exist |
| V6.4.3, V6.4.4 | Password reset and lost factors | n/a | No passwords; a lost device is removed by a member, a lost group restored with the recovery key in the apps |
| V6.5.1 to V6.5.5 | Lookup secrets, out-of-band codes, TOTP | n/a | None; the 6-digit pairing check runs between the apps |
| V6.6.1 to V6.6.3 | Out-of-band authentication | n/a | None |
| V6.8.1 to V6.8.4 | Identity providers | n/a | None |

## V7 Session Management

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V7.1.1 | Document inactivity and absolute lifetime | partly | 15 minutes absolute in `spec/api.md`; no reasoning against NIST SP 800-63B |
| V7.1.2 | Document concurrent sessions | partly | Two live connections per device (`spec/live.md`); valid HTTP tokens per device are unlimited and undocumented |
| V7.1.3 | Federated session coordination | n/a | No federation |
| V7.2.1 | Verify tokens on the backend | met | `auth/device.ts:29-31` |
| V7.2.2 | Dynamic tokens, not static API secrets | partly | Device tokens are issued per challenge (`routes/auth.ts:59-60`); the admin token is a static secret sent on every admin call (`auth/admin.ts:14-16`) |
| V7.2.3 | Reference tokens from a CSPRNG, 128 bits | n/a | Tokens are self-contained (V9) |
| V7.2.4 | New token on authentication, old one ended | partly | Each sign-in issues a new token; earlier ones stay valid until they expire (`auth/token.ts:33`) |
| V7.3.1 | Inactivity timeout | met | The 15-minute absolute lifetime is shorter than any useful inactivity timeout |
| V7.3.2 | Absolute session lifetime | met | `limits.ts:19`, enforced in `auth/token.ts:33` and for sockets in `live/hub.ts:78`, `:111`; `routes/auth.test.ts` "tokens expire and can't be altered" |
| V7.4.1 | Ended sessions can't be used | partly | Expiry and removal end a token; there's no sign-out that ends one early |
| V7.4.2 | Disabled accounts lose every session | met | Membership is checked on every request (`auth/device.ts:30`) and by the socket sweep (`live/hub.ts:106-115`); `routes/roster.test.ts` "removal needs every wrap and the chain, and revokes the device at once", `routes/live.test.ts` "a removed device is disconnected by the sweep" |
| V7.4.3 | End other sessions after a factor change | n/a | Device keys never change within a membership (`spec/crypto.md` Device keys) |
| V7.4.4 | Visible logout | n/a | No user interface |
| V7.4.5 | Administrators can end sessions | met | Any member removes a device; an admin reset ends every session (`routes/admin.ts:36-42`) |
| V7.5.1 | Re-authenticate before sensitive changes | met | Every roster change is an entry signed by the device key (`group.ts:137-153`) |
| V7.5.2 | View and end active sessions | met | `/v1/status` lists devices and when they were seen (`routes/status.ts:13-15`); removal ends their access |
| V7.6.1, V7.6.2 | Federated re-authentication | n/a | No federation |

## V8 Authorization

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V8.1.1 | Document function and data access rules | met | `spec/api.md` Endpoints (Auth column), Objects |
| V8.1.2 | Document field-level rules | n/a | Objects are opaque and JSON bodies have fixed shapes, so no rule is per field |
| V8.2.1 | Function-level access | met | `requireMember` or `requireAdmin` on every protected route; the recovery member only where a route opts in (`auth/device.ts:32`); `routes/auth.test.ts` "the recovery member authenticates but can't use device routes", `routes/join.test.ts` "asking needs the admin token, answering needs a member" |
| V8.2.2 | Data-specific access (IDOR, BOLA) | met | Own wrap only (`routes/keys.ts:14`), writes only under the caller's id (`routes/objects.ts:70`), deletes only its own or removed devices' paths (`routes/objects.ts:103`); `routes/keys.test.ts` "a member reads its own wrap and the chain, nothing else", `routes/objects.test.ts` "a device can't write as another device, and the recovery key can't write" |
| V8.2.3 | Field-level access (BOPLA) | met | Strict request schemas; responses list fixed fields (`routes/status.ts:13-15`, `routes/admin.ts:28-34`) |
| V8.3.1 | Authorization at a trusted layer | met | All checks are server middleware (`auth/`) |
| V8.4.1 | Cross-tenant controls | n/a | One group per instance (`spec/threat-model.md` G7) |

## V9 Self-contained Tokens

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V9.1.1 | Check the signature or MAC first | met | HMAC-SHA256 checked before the content is read (`auth/token.ts:29-33`) |
| V9.1.2 | Algorithm allowlist, no `none` | met | One fixed algorithm and no header |
| V9.1.3 | Keys from a trusted source | met | The instance secret lives in the server's own store (`group.ts:97-107`) |
| V9.2.1 | Check the validity period | met | `auth/token.ts:33` |
| V9.2.2 | Correct token type | met | One token type, MAC domain-separated (`auth/token.ts:9-10`) |
| V9.2.3 | Correct audience | met | The MAC key is per instance |
| V9.2.4 | Audience restriction for shared keys | n/a | The key serves one audience |

## V10 OAuth and OIDC

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V10.1.1 to V10.7.3 | OAuth and OIDC | n/a | Neither used nor provided |

## V11 Cryptography

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V11.1.1 | Key management policy | partly | Client keys are covered (`spec/crypto.md` Keys, `spec/protocol.md` Removal and Recovery); the server's token key and admin token have no documented lifecycle |
| V11.1.2 | Cryptographic inventory | partly | `spec/crypto.md` Suite 1 lists the algorithms; the token HMAC key isn't listed |
| V11.2.1 | Industry-validated implementations | met | WebCrypto Ed25519 and SHA-256 (`crypto.ts:6-18`), `@noble/hashes` HMAC (`auth/token.ts:2-3`) |
| V11.2.2 | Crypto agility | partly | Envelopes carry a suite byte (`spec/crypto.md` Suite 1); the token key can't be rotated and survives an admin reset (`group.ts:30`) |
| V11.2.3 | At least 128-bit security | met | Ed25519, SHA-256, HMAC-SHA256 with a 256-bit key |
| V11.3.1 to V11.3.3 | Block modes, ciphers and AEAD | n/a | The server never encrypts or decrypts; the apps use AES-256-GCM (`spec/crypto.md`) |
| V11.4.1 | Approved hash functions | met | SHA-256 only |
| V11.4.2 | Password hashing | n/a | No passwords; the admin token is kept only as its SHA-256, in memory (`config.ts:32`) |
| V11.4.3 | Collision-resistant hashes of 256 bits | met | SHA-256 names blobs and stored objects (`routes/objects.ts:72`) |
| V11.4.4 | Key derivation from passwords | n/a | No passwords |
| V11.5.1 | CSPRNG, 128 bits | met | Challenges and the token key are 256 random bits (`routes/auth.ts:35`, `group.ts:100`) |
| V11.6.1 | Approved signature algorithms | met | Ed25519 behind the reference key checks (`crypto.ts:14-18`); `crypto.test.ts` runs `spec/vectors/ed25519.json` |

## V12 Secure Communication

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V12.1.1 | TLS 1.2 or later | met | Caddy's defaults (TLS 1.2 and 1.3) in `deploy/docker/compose.yaml`; the other hosts terminate TLS themselves |
| V12.1.2 | Recommended cipher suites | met | As V12.1.1 |
| V12.1.3 | Validate mTLS client certificates | n/a | No mTLS |
| V12.2.1 | TLS for all external connections | met | Every template serves HTTPS; the apps refuse HTTP to public addresses (`spec/store.md` Transport security) |
| V12.2.2 | Publicly trusted certificates | met | Let's Encrypt through Caddy, or the host's |
| V12.3.1 | Encrypt every backend connection | partly | S3 and the host blob SDKs use HTTPS, D1 and R2 are bindings; Postgres TLS depends on `PGSSLMODE` or the URL (`deploy/docker/README.md` Settings) |
| V12.3.2 | TLS clients validate certificates | partly | The Heroku guide sets `PGSSLMODE=no-verify` (`docs/heroku.md:12`) |
| V12.3.3 | TLS between internal HTTP services | partly | Caddy reaches the server over plain HTTP on the Compose network (`deploy/docker/Caddyfile:2`) |
| V12.3.4 | Trusted certificates between internal services | partly | Heroku Postgres certificates aren't verified (`docs/heroku.md:12`) |

## V13 Configuration

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V13.1.1 | Document communication needs | met | The database and blob store per host (`deploy/docker/README.md` Settings, `docs/`); no user-supplied destinations |
| V13.2.1 | Backend authentication without static credentials | partly | Cloudflare uses platform bindings and Netlify Blobs the function context; Postgres URLs, S3 keys and the Vercel Blob token are static (`storage/from-env.ts`, `docs/vercel.md`) |
| V13.2.2 | Least-privilege backend accounts | partly | The server creates its tables, so its database role needs DDL rights; no guide suggests a narrower role |
| V13.2.3 | No default service credentials | met | Templates use host-generated credentials; `postgres:postgres` appears only in CI (`.github/workflows/ci.yml:82`) |
| V13.2.4, V13.2.5 | Allowlist of outbound destinations | met | The only destinations are the operator's database and bucket (`storage/from-env.ts:10-21`) |
| V13.3.1 | Secrets management | partly | The admin token comes from a file (`deploy/docker/compose.yaml:10-12`, `entry/node.ts:8-10`) or the host's secret store; some hosts keep it in plain environment variables |
| V13.3.2 | Least privilege on secrets | met | One container reads the secret; the server keeps only its hash (`config.ts:32`) |
| V13.4.1 | No source control metadata | met | The image holds only the bundle (`deploy/docker/Dockerfile:17`) |
| V13.4.2 | Debug modes off | met | No debug mode exists; `NODE_ENV=production` (`deploy/docker/Dockerfile:19`) |
| V13.4.3 | No directory listings | met | No static file serving |
| V13.4.4 | No HTTP TRACE | met | TRACE answers 404 like any unknown route (`app.ts:53-56`) |
| V13.4.5 | No exposed docs or monitoring | met | Only `/v1/health` and `/v1/info`, both intended (`routes/meta.ts`) |

## V14 Data Protection

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V14.1.1 | Identify and classify sensitive data | met | `spec/threat-model.md` Assets |
| V14.1.2 | Protection requirements per level | met | `spec/threat-model.md` Goals, `spec/api.md` Logging |
| V14.2.1 | No sensitive data in URLs | partly | Tokens travel in headers (`http/body.ts:38-41`, `routes/live.ts:10-17`), but the pairing slot id, a short-lived capability, is a path segment (`routes/pair.ts:10-11`) that host access logs can record |
| V14.2.2 | No caching in server components | met | `Cache-Control: no-store` on every response (`app.ts:43-46`); `app.test.ts` "every response carries the security headers" |
| V14.2.3 | No data to untrusted parties | met | No third-party calls or trackers |
| V14.2.4 | Data controls as documented | met | Logs hold route pattern, status, size, time and error code (`http/log.ts:8-22`); addresses stay in bounded memory maps (`limits/counters.ts`); `app.test.ts` "unknown routes answer not_found without echoing the path" |
| V14.3.1 | Clear client storage | n/a | No browser client |
| V14.3.2 | Anti-caching headers | met | `app.ts:45` |
| V14.3.3 | No sensitive data in browser storage | n/a | No browser client |

## V15 Secure Coding and Architecture

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V15.1.1 | Remediation time frames for dependencies | met | `SECURITY.md` "Vulnerable dependencies" (critical 7 days, high 30 days); Dependabot weekly (`.github/dependabot.yml`) and OSV scans (`.github/workflows/security.yml:26-37`) |
| V15.1.2 | SBOM from trusted sources | met | SPDX SBOM attested per release (`.github/workflows/release.yml:110-122`); installs use the lockfile |
| V15.1.3 | Document resource-heavy functions | met | `spec/api.md` Limits; signature and cold-start costs in `docs/cloudflare.md` |
| V15.2.1 | Components within those time frames | met | The OSV scan fails on known vulnerabilities (`.github/workflows/security.yml:35-37`) |
| V15.2.2 | Availability defenses | partly | Body limits, timeouts (`runtime/node.ts:41`), quota and rate limits; see V2.4.1 and V2.3.4 |
| V15.2.3 | No test or development code in production | met | Bundles start from the entries (`.github/workflows/ci.yml:49-61`); `testing/` isn't reachable from them |
| V15.3.1 | Return only required fields | met | `routes/status.ts:13-15`, `routes/objects.ts:114-117` |
| V15.3.2 | Don't follow redirects | n/a | No outbound HTTP to request-chosen URLs |
| V15.3.3 | Mass assignment | met | `z.strictObject` on JSON bodies; stored fields set one by one (`routes/objects.ts:81-86`) |
| V15.3.4 | Trusted client address | partly | As V4.1.3 |
| V15.3.5 | Strict types and comparisons | met | TypeScript strict mode, zod parsing, strict equality |
| V15.3.6 | No prototype pollution | met | State lives in `Map`s (`limits/counters.ts`, `live/hub.ts:31-39`); zod drops a `__proto__` key in `wraps` |
| V15.3.7 | HTTP parameter pollution | met | Each value is read from one place: query, path or body |

## V16 Security Logging and Error Handling

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V16.1.1 | Log inventory | partly | `spec/api.md` Logging says what is logged, not where it goes, who reads it or for how long |
| V16.2.1 | When, where, who and what | partly | Method, route, status, duration, size, error code (`http/log.ts:12-20`); the timestamp comes from the host; no device or address, by design (`spec/threat-model.md` G6) |
| V16.2.2 | Synchronized UTC timestamps | partly | Left to the host's log collector |
| V16.2.3 | Only documented log sinks | met | Standard output only (`entry/node.ts:16`, `entry/workers.ts:23`, `entry/functions.ts:14`) |
| V16.2.4 | Common log format | met | JSON lines |
| V16.2.5 | Sensitive data by protection level | met | Never bodies, paths, headers, tokens or addresses (`http/log.ts:12-20`) |
| V16.3.1 | Log authentication events | partly | Every sign-in and admin call is a line with its status and error code, without a device id |
| V16.3.2 | Log failed authorization | met | 401 and 403 lines carry their error code (`http/log.ts:20`) |
| V16.3.3 | Log security events and bypass attempts | partly | 400, 413, 415 and 429 are logged with their code; the start of a ban isn't |
| V16.3.4 | Log unexpected errors | partly | Logged only as `internal`, without the error's type (`http/errors.ts:39`, `app.ts:49-52`) |
| V16.4.1 | Prevent log injection | met | `JSON.stringify` of fixed fields, the route pattern rather than the path |
| V16.4.2 | Protect logs | partly | Left to the host and undocumented |
| V16.4.3 | Send logs to a separate system | partly | Hosts collect them separately; the Docker template keeps them on the same machine |
| V16.5.1 | Generic error messages | met | `{"error":"<code>"}` only (`http/errors.ts:42-49`); `app.test.ts` "unknown routes answer not_found without echoing the path" |
| V16.5.2 | Keep working when resources fail | met | Storage errors end as 500 `internal`; the Postgres pool survives lost connections (`storage/postgres.ts:67-73`) |
| V16.5.3 | Fail closed | met | Authentication throws before a handler runs (`auth/device.ts:31`, `auth/admin.ts:16-19`); objects are checked before they're stored (`routes/objects.ts:78-80`) |

## V17 WebRTC

| Id | Requirement (short) | Status | Where / why |
|---|---|---|---|
| V17.1.1 to V17.3.2 | TURN, media and signaling | n/a | No WebRTC; the live relay is a WebSocket (V4.4) |
