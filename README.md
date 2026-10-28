# flow-sync

Linked devices for [Flow](https://github.com/Flow-Tube/Flow) and [Flow Desktop](https://github.com/Flow-Tube/Flow-Desktop), with a self-hostable sync server that never sees your data.

- **Zero-knowledge.** Devices encrypt everything before it leaves them. The server stores and forwards ciphertext, verifies signatures, and holds no key that opens your history, interests, playlists, settings or profile names.
- **One person's devices.** One sync group per instance. Devices pair with a QR code and a 6-digit check, and removing a device rotates the group key.
- **Your choice of storage.** A Flow server, WebDAV (Nextcloud, Koofr and others), S3-compatible storage, or LAN only. All of them hold the same encrypted format.
- **Recovery key.** Shown once as 24 words and a QR code. It restores the group onto a new device; the server still can't read anything.

## Status

The FLOW-SYNC/2 specification is in review. There is no server release yet. Nothing is hosted by the maintainers: every instance is self-hosted.

## Repository

| Path | Contents |
|---|---|
| [`spec/`](spec/) | Threat model, cryptography, protocol, store format, server API, live channel, test vectors |
| `packages/protocol/` | TypeScript reference implementation and vector generator |
| `packages/server/` | The sync server (Hono; Node, Bun, Deno, Cloudflare Workers, Vercel, Netlify, Docker) |

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
