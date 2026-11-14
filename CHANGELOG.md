# Changelog

## 0.1.0-beta

The first release of FLOW-SYNC/2: linked devices for Flow for Android and Flow Desktop, and a self-hostable server that stores only ciphertext.

### Protocol

- The FLOW-SYNC/2 specification in `spec/`: threat model, cryptography, protocol, store format, server API and live channel, with test vectors that the TypeScript reference, Flow for Android and Flow Desktop all pass.
- Devices pair with a QR code and a 6-digit check, keep a signed roster, and encrypt every object with per-epoch keys. Removing a device or leaving starts a new epoch.
- A 24-word recovery key restores the group onto a new device.
- Stores: a Flow server, a WebDAV folder, or the local network only. The specification also defines S3-compatible storage, which the apps don't offer yet.
- Profiles: each device chooses which of its profiles sync.
- A device can leave collections out of a link, so the user chooses what each device syncs.
- Live: "Play on" another device and remote control, through the server or over the local network.

### Server

- One group per instance. Runs on Node with SQLite or Postgres, optionally with object bytes in S3, and on Cloudflare Workers (D1, R2, Durable Object), Vercel and Netlify (no live features there).
- Deployment templates and guides for Docker, Cloudflare Workers, Vercel, Netlify, Heroku, Railway, Render and Fly.io in `deploy/` and `docs/`.
- Signed, reproducible container images with build provenance and an SBOM. Each release attaches a `compose.yaml` pinned to its image.
- Security documentation: what the server can and can't see (`docs/security.md`), recovery (`docs/recovery.md`), and mappings to OWASP ASVS 5.0 Level 2 and the API Security Top 10.

### Known limits

- Heroku, Railway, Render and Fly.io are templates tested against the same image but not yet deployed to those hosts.
- Groups that sync only over the local network are untested on a real network, and devices may not find each other where the network drops multicast between them.
- The storage quota can be exceeded by up to one 4 MiB object per upload running at the same time.
- Everything the store can see is listed in `spec/threat-model.md`: object counts, padded sizes, timing, the number of devices and their public keys.
