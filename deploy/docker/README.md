# Docker

The image runs as a non-root user on a distroless Node base, keeps its data in `/data`, and listens on port 8080.

## With HTTPS (recommended)

`compose.yaml` runs the server behind Caddy, which gets certificates from Let's Encrypt. It needs a public DNS name pointing at the host, and ports 80 and 443 open.

```sh
openssl rand -hex 32 > admin_token
FLOW_SYNC_DOMAIN=sync.example.org docker compose up -d
```

Use the admin token once, from Flow, to claim the instance. Set `FLOW_SYNC_ADMIN=off` afterwards if you don't need admin access.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `FLOW_SYNC_ADMIN_TOKEN` or `FLOW_SYNC_ADMIN_TOKEN_FILE` | none | Claims the instance and opens `/v1/admin`. At least 32 characters |
| `FLOW_SYNC_ADMIN` | `on` | `off` closes admin access |
| `FLOW_SYNC_QUOTA` | 2 GiB | Storage limit in bytes |
| `FLOW_SYNC_TRUST_PROXY` | off | `1` takes the client address from the proxy's `X-Forwarded-For` |
| `FLOW_SYNC_SECURITY_CONTACT`, `FLOW_SYNC_SECURITY_EXPIRES` | none | Serve `/.well-known/security.txt` |
| `FLOW_SYNC_DATA` | `/data/flow-sync.db` | SQLite database path |
| `PORT` | 8080 | Listening port |

Guides for NAS systems and other hosts arrive with the release.
