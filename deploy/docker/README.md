# Docker

The image runs as a non-root user on a distroless Node base, keeps its data in `/data`, and listens on port 8080.

## With HTTPS (recommended)

`compose.yaml` runs the server behind Caddy, which gets certificates from Let's Encrypt. It needs a public DNS name pointing at the host, and ports 80 and 443 open.

```sh
mkdir flow-sync && cd flow-sync
curl -fLO https://github.com/Flow-Tube/flow-sync/releases/latest/download/compose.yaml
curl -fLO https://github.com/Flow-Tube/flow-sync/releases/latest/download/Caddyfile
openssl rand -hex 32 > admin_token
FLOW_SYNC_DOMAIN=sync.example.org docker compose up -d
```

The release's `compose.yaml` pins the image to that version and digest. To update, download both files from the new release and run `docker compose up -d` again.

Use the admin token once, from Flow, to claim the instance. Set `FLOW_SYNC_ADMIN=off` afterwards if you don't need admin access.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `FLOW_SYNC_ADMIN_TOKEN` or `FLOW_SYNC_ADMIN_TOKEN_FILE` | none | Claims the instance and opens `/v1/admin`. At least 32 characters |
| `FLOW_SYNC_ADMIN` | `on` | `off` closes admin access |
| `FLOW_SYNC_QUOTA` | 2 GiB | Storage limit in bytes |
| `FLOW_SYNC_TRUST_PROXY` | off | `1` takes the client address from the last `X-Forwarded-For` hop. Set it only when every request reaches the server through a proxy that adds that hop (Caddy here, or the host's router); otherwise a client can name any address and slip past the per-address limits |
| `FLOW_SYNC_SECURITY_CONTACT`, `FLOW_SYNC_SECURITY_EXPIRES` | none | Serve `/.well-known/security.txt` |
| `FLOW_SYNC_DATA` | `/data/flow-sync.db` | SQLite database path |
| `FLOW_SYNC_DATABASE_URL` or `DATABASE_URL` | none | Stores everything in Postgres instead of SQLite. When the database is reached over a network, set `PGSSLMODE=verify-full` so the connection is encrypted and the server's certificate is checked |
| `FLOW_SYNC_S3_BUCKET` | none | Stores object bytes in this S3 bucket (AWS, R2 or any S3-compatible store) under `flow-sync/blobs/`. Configure it with the standard `AWS_REGION`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| `FLOW_SYNC_S3_PATH_STYLE` | off | `1` for stores that need path-style addressing (most self-hosted ones) |
| `PORT` | 8080 | Listening port |

Guides for the other hosts are in [docs](../../docs/README.md).

## Verifying an image

Release images are signed with Sigstore (keyless, from this repository's release workflow) and carry build provenance and an SPDX SBOM. Check a release before running it:

```sh
cosign verify ghcr.io/flow-tube/flow-sync:<version> \
  --certificate-identity-regexp '^https://github\.com/Flow-Tube/flow-sync/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/flow-tube/flow-sync:<version> -R Flow-Tube/flow-sync
```

Use cosign 3.1.3 or later. Each release is also rebuilt from scratch in CI, and the job fails unless the rebuilt image is byte-identical to the published one.
